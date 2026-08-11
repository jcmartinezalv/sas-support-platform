using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

internal static class Program
{
    private const uint MouseMove=0x0001,LeftDown=0x0002,LeftUp=0x0004,RightDown=0x0008,RightUp=0x0010,MiddleDown=0x0020,MiddleUp=0x0040,Wheel=0x0800,HorizontalWheel=0x01000,VirtualDesktop=0x4000,Absolute=0x8000;
    private const uint ExtendedKey=0x0001,KeyUp=0x0002,Unicode=0x0004,CF_UNICODETEXT=13,GMEM_MOVEABLE=0x0002;
    private const int ClipboardMaxChars=200000,SM_XVIRTUALSCREEN=76,SM_YVIRTUALSCREEN=77,SM_CXVIRTUALSCREEN=78,SM_CYVIRTUALSCREEN=79;
    private const uint SasInputMarker=0x53415331;
    private static readonly HashSet<byte> PressedKeys=new HashSet<byte>();
    private static readonly HashSet<string> PressedButtons=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    [DllImport("user32.dll",SetLastError=true)] private static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll",SetLastError=true)] private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll",EntryPoint="SetProcessDpiAwarenessContext")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern short VkKeyScan(char ch);
    [DllImport("user32.dll",SetLastError=true)] private static extern uint SendInput(uint count,INPUT[] inputs,int size);
    [DllImport("user32.dll",SetLastError=true)] private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
    [DllImport("sas.dll",SetLastError=true)] private static extern void SendSAS(bool asUser);
    [DllImport("user32.dll",SetLastError=true)] private static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll",SetLastError=true)] private static extern bool CloseClipboard();
    [DllImport("user32.dll",SetLastError=true)] private static extern bool EmptyClipboard();
    [DllImport("user32.dll",SetLastError=true)] private static extern IntPtr SetClipboardData(uint format,IntPtr memory);
    [DllImport("user32.dll",SetLastError=true)] private static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll")] private static extern bool IsClipboardFormatAvailable(uint format);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr GlobalAlloc(uint flags,UIntPtr bytes);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr GlobalLock(IntPtr memory);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GlobalUnlock(IntPtr memory);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern UIntPtr GlobalSize(IntPtr memory);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr GlobalFree(IntPtr memory);
    private static int Main(string[] args)
    {
        AppDomain.CurrentDomain.ProcessExit+=(sender,eventArgs)=>{try{ReleaseAll();}catch{}};
        if(Array.Exists(args,a=>String.Equals(a,"--server",StringComparison.OrdinalIgnoreCase)))return RunServer();
        int pipeAt=Array.FindIndex(args,a=>String.Equals(a,"--pipe-server",StringComparison.OrdinalIgnoreCase));
        if(pipeAt>=0)return RunPipeServer(pipeAt+1<args.Length?args[pipeAt+1]:"SASInputDesktopV3");
        return RunOnce(args);
    }
    private static int RunServer()
    {
        string line;
        while((line=Console.ReadLine())!=null)
        {
            if(String.IsNullOrWhiteSpace(line))continue;
            try{string raw=Encoding.UTF8.GetString(Convert.FromBase64String(line.Trim()));RunOnce(raw.Split(new[]{'\0'},StringSplitOptions.None));}
            catch(Exception ex){Console.WriteLine(Json(false,null,null,"input_server_request_invalid: "+ex.Message));}
        }
        return 0;
    }
    private static int RunPipeServer(string pipeName)
    {
        if(String.IsNullOrWhiteSpace(pipeName)||pipeName.Length>80)throw new InvalidOperationException("invalid_input_pipe_name");
        while(true)
        {
            using(NamedPipeServerStream pipe=CreateInputPipe(pipeName))
            {
                pipe.WaitForConnection();
                using(StreamReader reader=new StreamReader(pipe,Encoding.UTF8,false,65536,true))
                using(StreamWriter writer=new StreamWriter(pipe,new UTF8Encoding(false),65536,true))
                {
                    writer.AutoFlush=true;
                    string line=reader.ReadLine();
                    if(String.IsNullOrWhiteSpace(line)){writer.WriteLine(Json(false,null,null,"empty_input_request"));continue;}
                    try
                    {
                        string raw=Encoding.UTF8.GetString(Convert.FromBase64String(line.Trim()));
                        int code=RunOnce(raw.Split(new[]{'\0'},StringSplitOptions.None),writer);
                        if(code!=0){} // RunOnce already returned the structured result.
                    }
                    catch(Exception ex){writer.WriteLine(Json(false,null,null,"input_pipe_request_invalid: "+ex.Message));}
                }
            }
        }
    }
    private static NamedPipeServerStream CreateInputPipe(string pipeName)
    {
        PipeSecurity security=new PipeSecurity();
        SecurityIdentifier current=WindowsIdentity.GetCurrent().User;
        if(current!=null)security.AddAccessRule(new PipeAccessRule(current,PipeAccessRights.FullControl,AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),PipeAccessRights.FullControl,AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null),PipeAccessRights.FullControl,AccessControlType.Allow));
        return new NamedPipeServerStream(pipeName,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.None,65536,65536,security);
    }
    private static int RunOnce(string[] args){return RunOnce(args,null);}
    private static int RunOnce(string[] args,TextWriter response)
    {
        InputOptions o=InputOptions.FromArgs(args);
        try
        {
            InputEvidence.Reset(o.Type);
            EnsureDpiAwareness();
            DesktopAccess.AttachToInputDesktop();
            InputEvidence.ObserveIntegrity(o);
            if(RequiresSendInput(o.Type))InputEvidence.RequireCompatibleTarget();
            string dataJson=null;
            if(o.Type=="mouse_move")Move(o.X,o.Y);
            else if(o.Type=="mouse_move_relative")MoveRelative(o.DeltaX,o.DeltaY);
            else if(o.Type=="mouse_button"){if(o.Action!="down"&&o.Action!="up")throw new InvalidOperationException("mouse_button_action_invalid");if(o.HasX&&o.HasY)Move(o.X,o.Y);SetMouseButton(o.Button,o.Action=="down");}
            else if(o.Type=="mouse_click")Click(o.X,o.Y,o.Button,1);
            else if(o.Type=="mouse_double_click")Click(o.X,o.Y,o.Button,2);
            else if(o.Type=="mouse_wheel")WheelMouse(o.Delta,o.HorizontalDelta);
            else if(o.Type=="key_down")SetKeys(o.Keys,true,o.Repeat);
            else if(o.Type=="key_up")SetKeys(o.Keys,false);
            else if(o.Type=="key_press")SendChord(o.Keys);
            else if(o.Type=="text_input")SendUnicode(o.Text);
            else if(o.Type=="release_input")ReleaseAll();
            else if(o.Type=="clipboard_set"){SetClipboardText(o.Text);dataJson="{\"length\":"+o.Text.Length+"}";}
            else if(o.Type=="clipboard_get"){string clipboard=GetClipboardText();dataJson="{\"text\":"+Q(clipboard)+",\"length\":"+clipboard.Length+"}";}
            else if(o.Type=="secure_attention")SendSecureAttention();
            else if(o.Type=="health_check"){}
            else throw new InvalidOperationException("Unsupported event type: "+o.Type);
            WriteResult(o.ResultFile,Json(true,o.Type,o.Type=="secure_attention"?"secure attention executed by SAS broker":"input executed",null,dataJson),response);return 0;
        }
        catch(Exception ex){Console.Error.WriteLine(ex.Message);WriteResult(o.ResultFile,Json(false,null,null,ex.Message),response);return 1;}
    }
    private static bool RequiresSendInput(string type){return type=="mouse_button"||type=="mouse_click"||type=="mouse_double_click"||type=="mouse_wheel"||type=="key_down"||type=="key_up"||type=="key_press"||type=="text_input"||type=="release_input";}
    private static void EnsureDpiAwareness(){try{if(SetProcessDpiAwarenessContext(new IntPtr(-4)))return;}catch(EntryPointNotFoundException){}catch{}try{SetProcessDPIAware();}catch{}}
    private static int NormalizeAbsolute(int value,int origin,int span){if(span<=1)throw new InvalidOperationException("virtual_desktop_metrics_invalid");long normalized=((long)value-origin)*65535L/(span-1);return(int)Math.Max(0,Math.Min(65535,normalized));}
    private static bool CursorMatches(int x,int y,out POINT point){if(!GetCursorPos(out point))throw new InvalidOperationException("GetCursorPos failed: "+Marshal.GetLastWin32Error());return Math.Abs(point.X-x)<=2&&Math.Abs(point.Y-y)<=2;}
    private static void Move(int x,int y){POINT point;if(SetCursorPos(x,y)){Thread.Sleep(2);if(CursorMatches(x,y,out point))return;}int setCursorError=Marshal.GetLastWin32Error(),left=GetSystemMetrics(SM_XVIRTUALSCREEN),top=GetSystemMetrics(SM_YVIRTUALSCREEN),width=GetSystemMetrics(SM_CXVIRTUALSCREEN),height=GetSystemMetrics(SM_CYVIRTUALSCREEN);SendInputChecked(new[]{INPUT.MouseAbsolute(NormalizeAbsolute(x,left,width),NormalizeAbsolute(y,top,height))},"mouse_move_absolute_fallback",8);if(!CursorMatches(x,y,out point))throw new InvalidOperationException("cursor_position_not_applied: expected="+x+","+y+"; actual="+point.X+","+point.Y+"; virtual="+left+","+top+","+width+","+height+"; setCursorError="+setCursorError);}
    private static void MoveRelative(int dx,int dy){if(Math.Abs(dx)>32767||Math.Abs(dy)>32767)throw new InvalidOperationException("relative_mouse_delta_out_of_range");POINT point;if(!GetCursorPos(out point))throw new InvalidOperationException("GetCursorPos failed: "+Marshal.GetLastWin32Error());Move(checked(point.X+dx),checked(point.Y+dy));}
    private static void SendInputChecked(INPUT[] inputs,string operation,int settleMs=25){if(inputs.Length==0)return;uint before=LastInputTick(),sent=SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)));int error=sent==(uint)inputs.Length?0:Marshal.GetLastWin32Error();Thread.Sleep(settleMs);InputEvidence.Record(operation,inputs.Length,sent,error,before,LastInputTick());if(sent!=(uint)inputs.Length)throw new InvalidOperationException("SendInput "+operation+" failed: requested="+inputs.Length+", sent="+sent+", win32="+error);}
    private static void MouseFlags(string button,out uint down,out uint up){down=LeftDown;up=LeftUp;if(button=="right"){down=RightDown;up=RightUp;}else if(button=="middle"){down=MiddleDown;up=MiddleUp;}else if(button!="left")throw new InvalidOperationException("Unsupported mouse button: "+button);}
    private static void SetMouseButton(string button,bool pressed){uint down,up;MouseFlags(button,out down,out up);if(pressed){bool first=PressedButtons.Add(button);try{SendInputChecked(new[]{INPUT.Mouse(down,0)},"mouse_"+button+"_down",18);}catch{if(first)PressedButtons.Remove(button);throw;}}else{SendInputChecked(new[]{INPUT.Mouse(up,0)},"mouse_"+button+"_up",18);PressedButtons.Remove(button);}}
    private static void Click(int x,int y,string button,int count){Move(x,y);for(int i=0;i<count;i++){SetMouseButton(button,true);Thread.Sleep(55);SetMouseButton(button,false);if(count>1&&i+1<count)Thread.Sleep(90);}}
    private static void WheelMouse(int delta,int horizontalDelta){if(delta==0&&horizontalDelta==0)return;List<INPUT> inputs=new List<INPUT>();if(delta!=0)inputs.Add(INPUT.Mouse(Wheel,unchecked((uint)delta)));if(horizontalDelta!=0)inputs.Add(INPUT.Mouse(HorizontalWheel,unchecked((uint)horizontalDelta)));SendInputChecked(inputs.ToArray(),"mouse_wheel",24);}    private static void SendSecureAttention(){try{using(NamedPipeClientStream client=new NamedPipeClientStream(".","SASSecureAttention",PipeDirection.InOut)){client.Connect(3000);using(StreamReader reader=new StreamReader(client)){using(StreamWriter writer=new StreamWriter(client)){writer.AutoFlush=true;writer.WriteLine("SEND_SAS");string response=reader.ReadLine();if(response!="OK")throw new InvalidOperationException(response??"secure_attention_broker_no_response");}}}}catch(TimeoutException){throw new InvalidOperationException("secure_attention_broker_unavailable");}}
    private static uint KeyFlags(byte key,bool released){return(released?KeyUp:0)|(KeyMap.IsExtended(key)?ExtendedKey:0);}
    private static void SetKeys(string[] keys,bool pressed,bool repeat=false){if(keys.Length==0)throw new InvalidOperationException("Empty key transition.");foreach(string name in keys){byte key=KeyMap.ToVirtualKey(name);if(pressed){bool first=PressedKeys.Add(key);if(!first&&!repeat)continue;try{SendInputChecked(new[]{INPUT.VirtualKey(key,KeyFlags(key,false))},repeat?"key_repeat":"key_down",12);}catch{if(first)PressedKeys.Remove(key);throw;}}else{SendInputChecked(new[]{INPUT.VirtualKey(key,KeyFlags(key,true))},"key_up",12);PressedKeys.Remove(key);}}}
    private static void SendChord(string[] keys){if(keys.Length==0)throw new InvalidOperationException("Empty key chord.");SetKeys(keys,true);Thread.Sleep(45);for(int i=keys.Length-1;i>=0;i--)SetKeys(new[]{keys[i]},false);}
    private static void SendUnicode(string text){if(String.IsNullOrEmpty(text))return;if(text.Length>4000)throw new InvalidOperationException("text_input_too_large");for(int offset=0;offset<text.Length;offset+=32){int count=Math.Min(32,text.Length-offset);List<INPUT> inputs=new List<INPUT>(count*2);for(int i=0;i<count;i++){char c=text[offset+i];inputs.Add(INPUT.Keyboard(c,Unicode));inputs.Add(INPUT.Keyboard(c,Unicode|KeyUp));}SendInputChecked(inputs.ToArray(),"unicode_text",8);}}
    private static void ReleaseAll(){List<INPUT> inputs=new List<INPUT>();foreach(byte key in new List<byte>(PressedKeys))inputs.Add(INPUT.VirtualKey(key,KeyFlags(key,true)));inputs.Add(INPUT.Mouse(LeftUp,0));inputs.Add(INPUT.Mouse(RightUp,0));inputs.Add(INPUT.Mouse(MiddleUp,0));SendInputChecked(inputs.ToArray(),"release_all");PressedKeys.Clear();PressedButtons.Clear();}
    private static void OpenClipboardWithRetry(){for(int i=0;i<12;i++){if(OpenClipboard(IntPtr.Zero))return;Thread.Sleep(20);}throw new InvalidOperationException("clipboard_busy: "+Marshal.GetLastWin32Error());}
    private static void SetClipboardText(string text){if(text==null)text="";if(text.Length>ClipboardMaxChars)throw new InvalidOperationException("clipboard_text_too_large");OpenClipboardWithRetry();IntPtr memory=IntPtr.Zero;try{if(!EmptyClipboard())throw new InvalidOperationException("clipboard_empty_failed: "+Marshal.GetLastWin32Error());byte[] bytes=Encoding.Unicode.GetBytes(text+"\0");memory=GlobalAlloc(GMEM_MOVEABLE,(UIntPtr)bytes.Length);if(memory==IntPtr.Zero)throw new InvalidOperationException("clipboard_allocation_failed");IntPtr target=GlobalLock(memory);if(target==IntPtr.Zero)throw new InvalidOperationException("clipboard_lock_failed");try{Marshal.Copy(bytes,0,target,bytes.Length);}finally{GlobalUnlock(memory);}if(SetClipboardData(CF_UNICODETEXT,memory)==IntPtr.Zero)throw new InvalidOperationException("clipboard_set_failed: "+Marshal.GetLastWin32Error());memory=IntPtr.Zero;}finally{CloseClipboard();if(memory!=IntPtr.Zero)GlobalFree(memory);}}
    private static string GetClipboardText(){if(!IsClipboardFormatAvailable(CF_UNICODETEXT))return "";OpenClipboardWithRetry();try{IntPtr memory=GetClipboardData(CF_UNICODETEXT);if(memory==IntPtr.Zero)throw new InvalidOperationException("clipboard_get_failed: "+Marshal.GetLastWin32Error());ulong size=GlobalSize(memory).ToUInt64();if(size>(ulong)((ClipboardMaxChars+1)*2))throw new InvalidOperationException("clipboard_text_too_large");IntPtr source=GlobalLock(memory);if(source==IntPtr.Zero)throw new InvalidOperationException("clipboard_lock_failed");try{string value=Marshal.PtrToStringUni(source)??"";return value.Substring(0,Math.Min(ClipboardMaxChars,value.Length));}finally{GlobalUnlock(memory);}}finally{CloseClipboard();}}    private static bool TrySendInput(INPUT[] inputs,out uint sent,out int error){sent=SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)));error=sent==(uint)inputs.Length?0:Marshal.GetLastWin32Error();return sent==(uint)inputs.Length;}
    private static uint LastInputTick(){LASTINPUTINFO info=new LASTINPUTINFO();info.cbSize=(uint)Marshal.SizeOf(typeof(LASTINPUTINFO));return GetLastInputInfo(ref info)?info.dwTime:0;}
    private static void WriteResult(string file,string json,TextWriter response=null){if(!String.IsNullOrEmpty(file)){Directory.CreateDirectory(Path.GetDirectoryName(file));File.WriteAllText(file,json,Encoding.UTF8);}if(response!=null){response.WriteLine(json);response.Flush();}else Console.WriteLine(json);}
    private static string Json(bool ok,string type,string message,string error){return Json(ok,type,message,error,null);}
    private static string Json(bool ok,string type,string message,string error,string dataJson){return "{\"ok\":"+(ok?"true":"false")+",\"type\":"+Q(type)+",\"message\":"+Q(message)+",\"error\":"+Q(error)+",\"data\":"+(dataJson??"null")+",\"diagnostic\":"+InputEvidence.Json(DesktopAccess.Snapshot())+",\"executedAt\":"+Q(DateTimeOffset.UtcNow.ToString("O"))+"}";}
    private static string Q(string value){return value==null?"null":"\""+value.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r","\\r").Replace("\n","\\n")+"\"";}
    [StructLayout(LayoutKind.Sequential)] private struct POINT{public int X,Y;}
    [StructLayout(LayoutKind.Sequential)] private struct LASTINPUTINFO{public uint cbSize,dwTime;}
    [StructLayout(LayoutKind.Sequential)] private struct INPUT{public uint type;public InputUnion U;public static INPUT Mouse(uint flags,uint data){INPUT input=new INPUT();input.type=0;input.U=new InputUnion();input.U.mi=new MOUSEINPUT();input.U.mi.dwFlags=flags;input.U.mi.mouseData=data;input.U.mi.extra=new UIntPtr(SasInputMarker);return input;}public static INPUT MouseAbsolute(int x,int y){INPUT input=Mouse(MouseMove|Absolute|VirtualDesktop,0);input.U.mi.dx=x;input.U.mi.dy=y;return input;}public static INPUT Keyboard(char scan,uint flags){INPUT input=new INPUT();input.type=1;input.U=new InputUnion();input.U.ki=new KEYBDINPUT();input.U.ki.wScan=scan;input.U.ki.dwFlags=flags;input.U.ki.extra=new UIntPtr(SasInputMarker);return input;}public static INPUT VirtualKey(byte key,uint flags){INPUT input=new INPUT();input.type=1;input.U=new InputUnion();input.U.ki=new KEYBDINPUT();input.U.ki.wVk=key;input.U.ki.dwFlags=flags;input.U.ki.extra=new UIntPtr(SasInputMarker);return input;}}
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion{[FieldOffset(0)]public MOUSEINPUT mi;[FieldOffset(0)]public KEYBDINPUT ki;}
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT{public int dx,dy;public uint mouseData,dwFlags,time;public UIntPtr extra;}
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT{public ushort wVk,wScan;public uint dwFlags,time;public UIntPtr extra;}
}
internal sealed class IntegritySnapshot
{
    internal int helperRid,targetRid,targetProcessId;internal long targetWindowHandle;internal string helperLevel="unknown",targetLevel="unknown",targetSource="unavailable",error=null;internal bool uipiRisk;
    internal string Json(){return "{\"helperLevel\":"+Q(helperLevel)+",\"helperRid\":"+helperRid+",\"targetLevel\":"+Q(targetLevel)+",\"targetRid\":"+targetRid+",\"targetProcessId\":"+targetProcessId+",\"targetSource\":"+Q(targetSource)+",\"targetWindowHandle\":"+Q(targetWindowHandle==0?null:"0x"+targetWindowHandle.ToString("X")) +",\"uipiRisk\":"+(uipiRisk?"true":"false")+",\"error\":"+Q(error)+"}";}
    private static string Q(string value){return value==null?"null":"\""+value.Replace("\\","\\\\").Replace("\"","\\\"")+"\"";}
}
internal static class InputIntegrity
{
    private const uint PROCESS_QUERY_LIMITED_INFORMATION=0x1000,TOKEN_QUERY=0x0008,GA_ROOT=2;private const int TokenIntegrityLevel=25;
    [DllImport("user32.dll")]private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]private static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")]private static extern IntPtr GetAncestor(IntPtr window,uint flags);
    [DllImport("user32.dll")]private static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern IntPtr OpenProcess(uint access,bool inherit,uint processId);
    [DllImport("kernel32.dll")]private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll",SetLastError=true)]private static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)]private static extern bool GetTokenInformation(IntPtr token,int tokenClass,IntPtr information,int length,out int returnLength);
    [DllImport("advapi32.dll")]private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("advapi32.dll")]private static extern IntPtr GetSidSubAuthority(IntPtr sid,uint index);
    [StructLayout(LayoutKind.Sequential)]private struct SID_AND_ATTRIBUTES{public IntPtr Sid;public uint Attributes;}
    [StructLayout(LayoutKind.Sequential)]private struct TOKEN_MANDATORY_LABEL{public SID_AND_ATTRIBUTES Label;}
    [StructLayout(LayoutKind.Sequential)]private struct POINT{public int X,Y;public POINT(int x,int y){X=x;Y=y;}}
    internal static IntegritySnapshot Capture(InputOptions options)
    {
        IntegritySnapshot value=new IntegritySnapshot();
        try
        {
            value.helperRid=ReadProcessRid(GetCurrentProcess(),false);value.helperLevel=Level(value.helperRid);
            bool pointerTarget=(options.Type=="mouse_click"||options.Type=="mouse_double_click"||(options.Type=="mouse_button"&&options.HasX&&options.HasY));
            IntPtr window=pointerTarget?WindowFromPoint(new POINT(options.X,options.Y)):GetForegroundWindow();value.targetSource=pointerTarget?"pointer_window":"foreground_window";
            if(window!=IntPtr.Zero){IntPtr root=GetAncestor(window,GA_ROOT);if(root!=IntPtr.Zero)window=root;}
            uint pid;if(window==IntPtr.Zero||GetWindowThreadProcessId(window,out pid)==0||pid==0){value.error=value.targetSource+"_process_unavailable";return value;}
            value.targetWindowHandle=window.ToInt64();value.targetProcessId=unchecked((int)pid);IntPtr process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,false,pid);if(process==IntPtr.Zero){value.error=value.targetSource+"_process_query_failed:"+Marshal.GetLastWin32Error();return value;}
            try{value.targetRid=ReadProcessRid(process,true);value.targetLevel=Level(value.targetRid);}finally{CloseHandle(process);}
            value.uipiRisk=value.helperRid>0&&value.targetRid>value.helperRid;return value;
        }
        catch(Exception ex){value.error=ex.Message;return value;}
    }
    private static int ReadProcessRid(IntPtr process,bool closeToken){IntPtr token=IntPtr.Zero;try{if(!OpenProcessToken(process,TOKEN_QUERY,out token))throw new InvalidOperationException("open_process_token_failed:"+Marshal.GetLastWin32Error());int needed;GetTokenInformation(token,TokenIntegrityLevel,IntPtr.Zero,0,out needed);if(needed<=0)throw new InvalidOperationException("integrity_size_unavailable:"+Marshal.GetLastWin32Error());IntPtr buffer=Marshal.AllocHGlobal(needed);try{if(!GetTokenInformation(token,TokenIntegrityLevel,buffer,needed,out needed))throw new InvalidOperationException("integrity_query_failed:"+Marshal.GetLastWin32Error());TOKEN_MANDATORY_LABEL label=(TOKEN_MANDATORY_LABEL)Marshal.PtrToStructure(buffer,typeof(TOKEN_MANDATORY_LABEL));IntPtr count=GetSidSubAuthorityCount(label.Label.Sid);if(count==IntPtr.Zero)throw new InvalidOperationException("integrity_sid_invalid");byte total=Marshal.ReadByte(count);if(total==0)throw new InvalidOperationException("integrity_sid_empty");IntPtr rid=GetSidSubAuthority(label.Label.Sid,(uint)(total-1));return rid==IntPtr.Zero?0:Marshal.ReadInt32(rid);}finally{Marshal.FreeHGlobal(buffer);}}finally{if(token!=IntPtr.Zero)CloseHandle(token);}}
    private static string Level(int rid){if(rid>=0x4000)return "system";if(rid>=0x3000)return "high";if(rid>=0x2100)return "medium_plus";if(rid>=0x2000)return "medium";if(rid>=0x1000)return "low";if(rid>0)return "untrusted";return "unknown";}
}
internal static class InputEvidence
{
    [DllImport("kernel32.dll")] private static extern uint WTSGetActiveConsoleSessionId();
    private static string operation="",method="not_applicable";private static int requested=0,error=0;private static uint sent=0,before=0,after=0;private static IntegritySnapshot integrity=new IntegritySnapshot();
    internal static void Reset(string value){operation=value??"";method="not_applicable";requested=0;sent=0;error=0;before=0;after=0;integrity=new IntegritySnapshot();}
    internal static void ObserveIntegrity(InputOptions options){integrity=InputIntegrity.Capture(options);}
    internal static void RequireCompatibleTarget(){if(integrity.uipiRisk)throw new InvalidOperationException("uipi_target_higher_integrity: helper="+integrity.helperLevel+"; target="+integrity.targetLevel+"; pid="+integrity.targetProcessId);}
    internal static void Record(string value,int expected,uint accepted,int win32,uint inputBefore,uint inputAfter){operation=value;requested+=expected;sent+=accepted;if(error==0&&accepted!=(uint)expected)error=win32;method="SendInput";if(before==0)before=inputBefore;after=inputAfter;}
    internal static string Json(string desktop){return "{\"stage\":\"native_injection\",\"helperRevision\":\"input-v9-pointer-recovery\",\"inputProfile\":\"setcursorpos_primary_sendinput_marked\",\"inputMarker\":\"0x53415331\",\"inputStructSize\":"+(IntPtr.Size==8?40:28)+",\"processSessionId\":"+System.Diagnostics.Process.GetCurrentProcess().SessionId+",\"activeConsoleSessionId\":"+WTSGetActiveConsoleSessionId()+",\"operation\":"+Q(operation)+",\"method\":"+Q(method)+",\"requested\":"+requested+",\"accepted\":"+sent+",\"win32Error\":"+error+",\"legacyFallback\":false,\"lastInputBefore\":"+before+",\"lastInputAfter\":"+after+",\"lastInputChanged\":"+(after!=0&&after!=before?"true":"false")+",\"processId\":"+System.Diagnostics.Process.GetCurrentProcess().Id+",\"windowsIdentity\":"+Q(WindowsIdentity.GetCurrent().Name)+",\"integrity\":"+integrity.Json()+",\"desktop\":"+desktop+"}";}
    private static string Q(string value){return value==null?"null":"\""+value.Replace("\\","\\\\").Replace("\"","\\\"")+"\"";}
}
internal static class DesktopAccess
{
    private const uint DESKTOP_READOBJECTS=0x0001,DESKTOP_CREATEWINDOW=0x0002,DESKTOP_CREATEMENU=0x0004,DESKTOP_CREATEHOOK=0x0008,DESKTOP_JOURNALRECORD=0x0010,DESKTOP_JOURNALPLAYBACK=0x0020,DESKTOP_ENUMERATE=0x0040,DESKTOP_WRITEOBJECTS=0x0080,DESKTOP_SWITCHDESKTOP=0x0100;
    private const uint WINSTA_ENUMDESKTOPS=0x0001,WINSTA_READATTRIBUTES=0x0002,WINSTA_ACCESSCLIPBOARD=0x0004,WINSTA_WRITEATTRIBUTES=0x0010,WINSTA_ACCESSGLOBALATOMS=0x0020,WINSTA_ENUMERATE=0x0100,WINSTA_READSCREEN=0x0200;
    [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)]private static extern IntPtr OpenWindowStation(string name,bool inherit,uint access);
    [DllImport("user32.dll",SetLastError=true)]private static extern bool SetProcessWindowStation(IntPtr station);
    [DllImport("user32.dll",SetLastError=true)]private static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
    [DllImport("user32.dll",SetLastError=true)]private static extern bool SetThreadDesktop(IntPtr desktop);
    [DllImport("user32.dll",SetLastError=true)]private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")]private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll")]private static extern IntPtr GetThreadDesktop(uint threadId);
    [DllImport("kernel32.dll")]private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)]private static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder info,uint length,out uint needed);
    private static readonly object Sync=new object();
    private static IntPtr interactiveStation=IntPtr.Zero;
    private static IntPtr inputDesktop=IntPtr.Zero;
    internal static string Snapshot(){return "{\"windowStation\":"+Q(ObjectName(GetProcessWindowStation()))+",\"threadDesktop\":"+Q(ObjectName(GetThreadDesktop(GetCurrentThreadId())))+",\"interactiveStationHandle\":"+Q("0x"+interactiveStation.ToInt64().ToString("X"))+",\"inputDesktopHandle\":"+Q("0x"+inputDesktop.ToInt64().ToString("X"))+"}";}
    private static string ObjectName(IntPtr handle){if(handle==IntPtr.Zero)return "unavailable";uint needed;GetUserObjectInformation(handle,2,null,0,out needed);StringBuilder value=new StringBuilder((int)Math.Max(needed/2,64));return GetUserObjectInformation(handle,2,value,(uint)(value.Capacity*2),out needed)?value.ToString():"win32:"+Marshal.GetLastWin32Error();}
    private static string Q(string value){return value==null?"null":"\""+value.Replace("\\","\\\\").Replace("\"","\\\"")+"\"";}
    internal static void AttachToInputDesktop()
    {
        lock(Sync)
        {
            if(interactiveStation==IntPtr.Zero)
            {
                uint stationAccess=WINSTA_ENUMDESKTOPS|WINSTA_READATTRIBUTES|WINSTA_ACCESSCLIPBOARD|WINSTA_WRITEATTRIBUTES|WINSTA_ENUMERATE|WINSTA_READSCREEN;
                interactiveStation=OpenWindowStation("WinSta0",false,stationAccess);
                if(interactiveStation==IntPtr.Zero)throw new InvalidOperationException("interactive_window_station_unavailable: "+Marshal.GetLastWin32Error());
                if(!SetProcessWindowStation(interactiveStation))throw new InvalidOperationException("interactive_window_station_attach_failed: "+Marshal.GetLastWin32Error());
            }
            uint desktopAccess=DESKTOP_READOBJECTS|DESKTOP_CREATEWINDOW|DESKTOP_WRITEOBJECTS|DESKTOP_SWITCHDESKTOP;
            IntPtr next=OpenInputDesktop(0,false,desktopAccess);
            if(next==IntPtr.Zero)throw new InvalidOperationException("input_desktop_unavailable: "+Marshal.GetLastWin32Error());
            if(!SetThreadDesktop(next)){int error=Marshal.GetLastWin32Error();CloseDesktop(next);throw new InvalidOperationException("input_desktop_attach_failed: "+error);}
            IntPtr previous=inputDesktop;inputDesktop=next;
            if(previous!=IntPtr.Zero&&previous!=next)CloseDesktop(previous);
        }
    }
}
internal sealed class InputOptions
{
    public string Type="",Button="left",Action="",Text="",ResultFile="";public int X,Y,Delta,HorizontalDelta,DeltaX,DeltaY;public bool HasX,HasY,Repeat;public string[] Keys=new string[0];
    public static InputOptions FromArgs(string[] args){InputOptions o=new InputOptions();for(int i=0;i<args.Length;i++){string a=args[i],n=i+1<args.Length?args[i+1]:"";int parsed;if(a=="--type"){o.Type=n;i++;}else if(a=="--x"&&Int32.TryParse(n,out parsed)){o.X=parsed;o.HasX=true;i++;}else if(a=="--y"&&Int32.TryParse(n,out parsed)){o.Y=parsed;o.HasY=true;i++;}else if(a=="--delta"&&Int32.TryParse(n,out parsed)){o.Delta=parsed;i++;}else if(a=="--horizontal-delta"&&Int32.TryParse(n,out parsed)){o.HorizontalDelta=parsed;i++;}else if(a=="--dx"&&Int32.TryParse(n,out parsed)){o.DeltaX=parsed;i++;}else if(a=="--dy"&&Int32.TryParse(n,out parsed)){o.DeltaY=parsed;i++;}else if(a=="--button"){o.Button=n.ToLowerInvariant();i++;}else if(a=="--action"){o.Action=n.ToLowerInvariant();i++;}else if(a=="--repeat"){o.Repeat=true;}else if(a=="--keys"){o.Keys=n.Split(new[]{'+'},StringSplitOptions.RemoveEmptyEntries);for(int k=0;k<o.Keys.Length;k++)o.Keys[k]=o.Keys[k].Trim();i++;}else if(a=="--key"){o.Keys=new[]{n};i++;}else if(a=="--text-base64"){o.Text=Encoding.UTF8.GetString(Convert.FromBase64String(n));i++;}else if(a=="--result-file"){o.ResultFile=n;i++;}}return o;}
}
internal static class KeyMap
{
    private static readonly Dictionary<string,byte> Map=new Dictionary<string,byte>(StringComparer.OrdinalIgnoreCase){{"ENTER",0x0D},{"TAB",0x09},{"ESC",0x1B},{"ESCAPE",0x1B},{"BACKSPACE",0x08},{"SPACE",0x20},{"DELETE",0x2E},{"INSERT",0x2D},{"HOME",0x24},{"END",0x23},{"PAGEUP",0x21},{"PAGEDOWN",0x22},{"LEFT",0x25},{"UP",0x26},{"RIGHT",0x27},{"DOWN",0x28},{"CTRL",0x11},{"CONTROL",0x11},{"ALT",0x12},{"SHIFT",0x10},{"WIN",0x5B},{"META",0x5B},{"CAPSLOCK",0x14},{"NUMLOCK",0x90},{"SCROLLLOCK",0x91},{"PRINTSCREEN",0x2C},{"PAUSE",0x13},{"CONTEXTMENU",0x5D},{"VOLUMEUP",0xAF},{"VOLUMEDOWN",0xAE},{"VOLUMEMUTE",0xAD},{"NUMPAD0",0x60},{"NUMPAD1",0x61},{"NUMPAD2",0x62},{"NUMPAD3",0x63},{"NUMPAD4",0x64},{"NUMPAD5",0x65},{"NUMPAD6",0x66},{"NUMPAD7",0x67},{"NUMPAD8",0x68},{"NUMPAD9",0x69},{"MULTIPLY",0x6A},{"ADD",0x6B},{"SUBTRACT",0x6D},{"DECIMAL",0x6E},{"DIVIDE",0x6F}};
    public static byte ToVirtualKey(string key){string k=key.Trim().ToUpperInvariant();byte v;if(Map.TryGetValue(k,out v))return v;if(k.Length==1&&Char.IsLetterOrDigit(k[0]))return(byte)k[0];int f;if(k.StartsWith("F")&&Int32.TryParse(k.Substring(1),out f)&&f>=1&&f<=24)return(byte)(0x6F+f);throw new InvalidOperationException("Unsupported key: "+key);}public static bool IsExtended(byte key){return key==0x21||key==0x22||key==0x23||key==0x24||key==0x25||key==0x26||key==0x27||key==0x28||key==0x2D||key==0x2E||key==0x5B||key==0x5D||key==0x6F;}
}
