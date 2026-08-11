using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;

public sealed class SasSecureAttentionBroker : ServiceBase
{
    private const string PipeName = "SASPrivilegedDesktop";
    private const string InputPipeName = "SASInputServiceDesktop";
    private Thread worker;
    private Thread inputSupervisor;
    private volatile bool stopping;
    private readonly object inputSync=new object();
    private IntPtr inputProcess=IntPtr.Zero;
    private uint inputProcessId;
    private uint inputSessionId=0xFFFFFFFF;
    private string inputLastError="input_bridge_not_started";
    private readonly Dictionary<string,DateTime> nonces = new Dictionary<string,DateTime>(StringComparer.Ordinal);
    private readonly Dictionary<string,DateTime> grants = new Dictionary<string,DateTime>(StringComparer.Ordinal);
    public SasSecureAttentionBroker(){ServiceName="SAS Secure Attention Broker";CanStop=true;AutoLog=false;}
    protected override void OnStart(string[] args){stopping=false;worker=new Thread(RunBroker);worker.IsBackground=true;worker.Start();inputSupervisor=new Thread(RunInputSupervisor);inputSupervisor.IsBackground=true;inputSupervisor.Start();}
    protected override void OnStop(){stopping=true;Wake();StopInputBridge();if(worker!=null)worker.Join(3000);if(inputSupervisor!=null)inputSupervisor.Join(3000);}
    private void Wake(){try{using(NamedPipeClientStream c=new NamedPipeClientStream(".",PipeName,PipeDirection.Out)){c.Connect(300);using(StreamWriter w=new StreamWriter(c)){w.AutoFlush=true;w.WriteLine("STOP");}}}catch{}}
    private void RunBroker(){while(!stopping){try{using(NamedPipeServerStream pipe=CreatePipe()){pipe.WaitForConnection();using(StreamReader reader=new StreamReader(pipe,Encoding.UTF8)){using(StreamWriter writer=new StreamWriter(pipe,Encoding.UTF8)){writer.AutoFlush=true;Handle(reader.ReadLine(),writer);}}}}catch(Exception){Thread.Sleep(200);}}}
    private void RunInputSupervisor()
    {
        while(!stopping)
        {
            try{EnsureInputBridge();}
            catch(Exception ex){lock(inputSync){inputLastError=Describe(ex);}}
            for(int i=0;i<15&&!stopping;i++)Thread.Sleep(100);
        }
    }
    private string EnsureInputBridge()
    {
        uint session=Native.GetActiveInteractiveSessionId();
        if(session==0xFFFFFFFF)throw new InvalidOperationException("interactive_session_unavailable");
        bool started=false;
        lock(inputSync)
        {
            bool running=inputProcess!=IntPtr.Zero&&inputSessionId==session&&Native.WaitForSingleObject(inputProcess,0)==258;
            if(!running)
            {
                StopInputBridgeLocked();
                StartedProcess process=PrivilegedProcess.StartInActiveSession(ResolveHelper("sas-input-helper","SasInputHelper.exe"),new[]{"--pipe-server",InputPipeName});
                inputProcess=process.Handle;inputProcessId=process.ProcessId;inputSessionId=session;inputLastError="";started=true;
            }
        }
        if(started)
        {
            Exception last=null;
            for(int i=0;i<50&&!stopping;i++)
            {
                try{RequestInputPipe(new[]{"--type","health_check"},400);lock(inputSync){inputLastError="";}return BridgeStatusJson();}
                catch(Exception ex){last=ex;Thread.Sleep(100);}
            }
            StopInputBridge();
            throw new InvalidOperationException("input_bridge_start_failed: "+Describe(last));
        }
        try
        {
            RequestInputPipe(new[]{"--type","health_check"},800);
            lock(inputSync){inputLastError="";}
            return BridgeStatusJson();
        }
        catch(Exception)
        {
            StopInputBridge();
            return EnsureInputBridge();
        }
    }
    private string RunServiceInput(string[] args)
    {
        EnsureInputBridge();
        try{return RequestInputPipe(args,3000);}
        catch(Exception first)
        {
            StopInputBridge();EnsureInputBridge();
            try{return RequestInputPipe(args,3000);}
            catch(Exception second){throw new InvalidOperationException("input_bridge_delivery_failed: "+Describe(first)+"; retry="+Describe(second));}
        }
    }
    private string RequestInputPipe(string[] args,int timeout)
    {
        using(NamedPipeClientStream client=new NamedPipeClientStream(".",InputPipeName,PipeDirection.InOut))
        {
            client.Connect(timeout);
            using(StreamReader reader=new StreamReader(client,Encoding.UTF8,false,65536,true))
            using(StreamWriter writer=new StreamWriter(client,new UTF8Encoding(false),65536,true))
            {
                writer.AutoFlush=true;writer.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(String.Join("\0",args))));
                string response=reader.ReadLine();
                if(String.IsNullOrWhiteSpace(response))throw new InvalidOperationException("input_bridge_empty_response");
                if(response.Length>1024*1024)throw new InvalidOperationException("input_bridge_response_too_large");
                if(response.IndexOf("\"ok\":true",StringComparison.OrdinalIgnoreCase)<0)throw new InvalidOperationException("input_bridge_rejected: "+response);
                return response;
            }
        }
    }
    private string BridgeStatusJson()
    {
        lock(inputSync){return "{\"ok\":"+(inputProcess!=IntPtr.Zero?"true":"false")+",\"ready\":"+(inputProcess!=IntPtr.Zero?"true":"false")+",\"mode\":\"service_supervised_session_bridge\",\"sessionId\":"+inputSessionId+",\"processId\":"+inputProcessId+",\"message\":\"SAS Input Service supervisa la entrada de la sesi\u00f3n activa\"}";}
    }
    private void StopInputBridge(){lock(inputSync){StopInputBridgeLocked();}}
    private void StopInputBridgeLocked()
    {
        if(inputProcess!=IntPtr.Zero){try{Native.TerminateProcess(inputProcess,0);}catch{}try{Native.CloseHandle(inputProcess);}catch{}}
        inputProcess=IntPtr.Zero;inputProcessId=0;inputSessionId=0xFFFFFFFF;
    }
    private static string Describe(Exception ex)
    {
        if(ex==null)return "unknown";Win32Exception win32=ex as Win32Exception;
        return Safe(ex.Message)+(win32==null?"":" [win32="+win32.NativeErrorCode+"]");
    }
    private static NamedPipeServerStream CreatePipe()
    {
        PipeSecurity security=new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),PipeAccessRights.FullControl,AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null),PipeAccessRights.FullControl,AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid,null),PipeAccessRights.ReadWrite,AccessControlType.Allow));
        return new NamedPipeServerStream(PipeName,PipeDirection.InOut,4,PipeTransmissionMode.Byte,PipeOptions.None,65536,65536,security);
    }    private void Handle(string line,StreamWriter writer)
    {
        try
        {
            if(line=="STOP"&&stopping){writer.WriteLine("OK");return;}
            string[] parts=(line??"").Split('|');
            if(parts.Length!=6||parts[0]!="1")throw new InvalidOperationException("invalid_request");
            long timestamp; if(!Int64.TryParse(parts[1],out timestamp))throw new InvalidOperationException("invalid_timestamp");
            long now=DateTimeOffset.UtcNow.ToUnixTimeSeconds();if(Math.Abs(now-timestamp)>30)throw new InvalidOperationException("expired_request");
            string nonce=parts[2];if(nonce.Length<16||nonce.Length>96)throw new InvalidOperationException("invalid_nonce");
            lock(nonces){DateTime cutoff=DateTime.UtcNow.AddMinutes(-2);foreach(string key in new List<string>(nonces.Keys))if(nonces[key]<cutoff)nonces.Remove(key);if(nonces.ContainsKey(nonce))throw new InvalidOperationException("replayed_request");}
            string secret=ReadAgentSecret();string signed=String.Join("|",parts,0,5);string expected=Hmac(secret,signed);if(!FixedEquals(expected,parts[5]))throw new InvalidOperationException("authentication_failed");
            lock(nonces){nonces[nonce]=DateTime.UtcNow;}
            string operation=parts[3];string[] args=DecodeArgs(parts[4]);string result;
            if(operation=="AUTHORIZE"){result=AuthorizePrivilegedControl();}
            else if(operation=="AUTHORIZE_APPROVED"){result=AuthorizeApprovedSession(args);}
            else if(operation=="INPUT_HEALTH"){result=EnsureInputBridge();}
            else if(operation=="INPUT_USER"){ValidateInput(args);result=RunUserInput(args);}
            else
            {
                args=RequireGrant(args);
                if(operation=="SEND_SAS"){Native.SendSAS(false);result="{\"ok\":true,\"message\":\"secure attention executed by privileged broker\"}";}
                else if(operation=="INPUT"){ValidateInput(args);result=RunServiceInput(args);}
                else if(operation=="CAPTURE"){ValidateCapture(args);result=RunWorker(ResolveHelper("sas-capture-helper","SasCaptureHelper.exe"),args);}
                else throw new InvalidOperationException("operation_not_allowed");
            }            writer.WriteLine("OK "+Convert.ToBase64String(Encoding.UTF8.GetBytes(result)));
        }
        catch(Exception ex){writer.WriteLine("ERROR "+Safe(ex.Message));}
    }
    private string AuthorizePrivilegedControl()
    {
        const string title="SAS - Control privilegiado";
        const string message="El tecnico solicita controlar aplicaciones abiertas como administrador y responder ventanas de UAC durante esta sesion de soporte.\r\n\r\nSeleccione Si para autorizar durante 20 minutos. Puede finalizar el soporte en cualquier momento.";
        uint response,session=Native.WTSGetActiveConsoleSessionId();
        if(session==0xFFFFFFFF)throw new InvalidOperationException("interactive_session_unavailable");
        const uint style=0x00000004|0x00000020|0x00010000|0x00040000;
        if(!Native.WTSSendMessage(IntPtr.Zero,session,title,(uint)(title.Length*2),message,(uint)(message.Length*2),style,60,out response,true))throw new Win32Exception(Marshal.GetLastWin32Error(),"privileged_consent_unavailable");
        if(response!=6)throw new UnauthorizedAccessException("privileged_control_rejected");
        return CreatePrivilegedGrant(DateTime.UtcNow.AddMinutes(20),"privileged control approved locally");
    }
    private string AuthorizeApprovedSession(string[] args)
    {
        string sessionId=Arg(args,"--session");
        if(String.IsNullOrWhiteSpace(sessionId)||sessionId.Length>128)throw new UnauthorizedAccessException("approved_session_required");
        return CreatePrivilegedGrant(DateTime.UtcNow.AddHours(12),"privileged control inherited from the explicit SAS support authorization");
    }
    private string CreatePrivilegedGrant(DateTime expires,string message)
    {
        byte[] bytes=new byte[32];using(RandomNumberGenerator rng=RandomNumberGenerator.Create())rng.GetBytes(bytes);string grant=Convert.ToBase64String(bytes);
        lock(grants){grants.Clear();grants[grant]=expires;}
        return "{\"ok\":true,\"grant\":\""+grant+"\",\"expiresAt\":\""+expires.ToString("O")+"\",\"message\":\""+message+"\"}";
    }
    private string[] RequireGrant(string[] args)
    {
        if(args.Length<2||args[0]!="--grant")throw new UnauthorizedAccessException("privileged_grant_required");string grant=args[1];DateTime expiry;
        lock(grants){if(!grants.TryGetValue(grant,out expiry)||expiry<DateTime.UtcNow){grants.Remove(grant);throw new UnauthorizedAccessException("privileged_grant_expired");}}
        string[] clean=new string[args.Length-2];Array.Copy(args,2,clean,0,clean.Length);return clean;
    }    private static string ReadAgentSecret(){DirectoryInfo d=new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);for(int i=0;i<8&&d!=null;i++,d=d.Parent){string p=Path.Combine(d.FullName,"agent-credential.json");if(File.Exists(p)){string json=File.ReadAllText(p,Encoding.UTF8);string marker="\"agentSecret\"";int at=json.IndexOf(marker,StringComparison.OrdinalIgnoreCase);if(at>=0){int colon=json.IndexOf(':',at+marker.Length),first=json.IndexOf('"',colon+1),last=first<0?-1:json.IndexOf('"',first+1);if(first>=0&&last>first){string value=json.Substring(first+1,last-first-1);if(value.Length>=24)return value;}}}}throw new InvalidOperationException("agent_credential_unavailable");}
    private static string Hmac(string secret,string value){using(HMACSHA256 h=new HMACSHA256(Encoding.UTF8.GetBytes(secret))){return Convert.ToBase64String(h.ComputeHash(Encoding.UTF8.GetBytes(value)));}}
    private static bool FixedEquals(string a,string b){byte[] x=Encoding.UTF8.GetBytes(a??""),y=Encoding.UTF8.GetBytes(b??"");int diff=x.Length^y.Length;for(int i=0;i<Math.Max(x.Length,y.Length);i++)diff|=(i<x.Length?x[i]:0)^(i<y.Length?y[i]:0);return diff==0;}
    private static string[] DecodeArgs(string payload){if(String.IsNullOrEmpty(payload))return new string[0];string raw=Encoding.UTF8.GetString(Convert.FromBase64String(payload));string[] args=raw.Split(new[]{'\0'},StringSplitOptions.None);if(args.Length>20)throw new InvalidOperationException("too_many_arguments");return args;}
    private static void ValidateInput(string[] a){string type=Arg(a,"--type");string[] allowed={"mouse_move","mouse_move_relative","mouse_button","mouse_click","mouse_double_click","mouse_wheel","key_down","key_up","key_press","text_input","release_input"};if(Array.IndexOf(allowed,type)<0)throw new InvalidOperationException("input_type_not_allowed");foreach(string item in a)if(item!=null&&item.Length>400000)throw new InvalidOperationException("input_argument_too_large");}
    private static void ValidateCapture(string[] a){foreach(string item in a)if(item!=null&&item.Length>80)throw new InvalidOperationException("capture_argument_too_large");int quality=IntArg(a,"--quality",50),width=IntArg(a,"--max-width",1440),monitor=IntArg(a,"--monitor",0);if(quality<35||quality>90||width<640||width>3840||monitor<0||monitor>15)throw new InvalidOperationException("invalid_capture_options");}
    private static string Arg(string[] a,string key){for(int i=0;i<a.Length-1;i++)if(a[i]==key)return a[i+1];return "";}
    private static int IntArg(string[] a,string key,int fallback){int n;return Int32.TryParse(Arg(a,key),out n)?n:fallback;}
    private static string ResolveHelper(string folder,string file){string adjacent=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,file);if(File.Exists(adjacent))return adjacent;DirectoryInfo d=new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);for(int i=0;i<8&&d!=null;i++,d=d.Parent){string p=Path.Combine(d.FullName,"tools",folder,"bin","Release",file);if(File.Exists(p))return p;}throw new FileNotFoundException("privileged_helper_missing",file);}
    private static string RunWorker(string executable,string[] args){string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"SAS","PrivilegedDesktop");Directory.CreateDirectory(root);string resultFile=Path.Combine(root,Guid.NewGuid().ToString("N")+".json");List<string> all=new List<string>(args);all.Add("--result-file");all.Add(resultFile);try{PrivilegedProcess.RunInActiveSession(executable,all.ToArray(),15000);if(!File.Exists(resultFile))throw new InvalidOperationException("privileged_worker_no_result");string json=File.ReadAllText(resultFile,Encoding.UTF8);if(json.Length>12*1024*1024)throw new InvalidOperationException("privileged_result_too_large");return json;}finally{try{File.Delete(resultFile);}catch{}}}
    private static string RunUserInput(string[] args)
    {
        string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"SAS","PrivilegedDesktop");Directory.CreateDirectory(root);
        string resultFile=Path.Combine(root,Guid.NewGuid().ToString("N")+".json");File.WriteAllText(resultFile,"",new UTF8Encoding(false));
        FileSecurity security=new FileSecurity();SecurityIdentifier system=new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),user=PrivilegedProcess.GetActiveUserSid();
        security.SetOwner(system);security.AddAccessRule(new FileSystemAccessRule(system,FileSystemRights.FullControl,AccessControlType.Allow));security.AddAccessRule(new FileSystemAccessRule(user,FileSystemRights.Modify,AccessControlType.Allow));File.SetAccessControl(resultFile,security);
        List<string> all=new List<string>(args);all.Add("--result-file");all.Add(resultFile);
        try{PrivilegedProcess.RunInActiveUserSession(ResolveHelper("sas-input-helper","SasInputHelper.exe"),all.ToArray(),15000);string json=File.ReadAllText(resultFile,Encoding.UTF8);if(String.IsNullOrWhiteSpace(json))throw new InvalidOperationException("interactive_worker_no_result");if(json.Length>1024*1024)throw new InvalidOperationException("interactive_result_too_large");return json;}
        finally{try{File.Delete(resultFile);}catch{}}
    }
    private static string RunUserWorker(string executable,string[] args){string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"SAS","InteractiveDesktop");Directory.CreateDirectory(root);string resultFile=Path.Combine(root,Guid.NewGuid().ToString("N")+".json");File.WriteAllText(resultFile,"",Encoding.UTF8);FileSecurity security=File.GetAccessControl(resultFile);security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid,null),FileSystemRights.Modify,AccessControlType.Allow));File.SetAccessControl(resultFile,security);List<string> all=new List<string>(args);all.Add("--result-file");all.Add(resultFile);try{PrivilegedProcess.RunInActiveUserSession(executable,all.ToArray(),10000);string json=File.ReadAllText(resultFile,Encoding.UTF8).Trim();if(String.IsNullOrEmpty(json))throw new InvalidOperationException("interactive_worker_no_result");if(json.Length>1024*1024)throw new InvalidOperationException("interactive_result_too_large");return json;}finally{try{File.Delete(resultFile);}catch{}}}
    private static string Safe(string v){return String.IsNullOrEmpty(v)?"broker_error":v.Replace("\r"," ").Replace("\n"," ").Replace("|","/").Substring(0,Math.Min(400,v.Length));}
    public void RunConsole(){stopping=false;inputSupervisor=new Thread(RunInputSupervisor);inputSupervisor.IsBackground=true;inputSupervisor.Start();RunBroker();}
    public static void Main(string[] args)
    {
        try
        {
            SasSecureAttentionBroker broker=new SasSecureAttentionBroker();
            if(args!=null&&Array.Exists(args,a=>String.Equals(a,"--console",StringComparison.OrdinalIgnoreCase))){broker.RunConsole();return;}
            ServiceBase.Run(broker);
        }
        catch(Exception ex)
        {
            try{string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"SAS","Client");Directory.CreateDirectory(root);File.AppendAllText(Path.Combine(root,"broker-startup.log"),"["+DateTime.UtcNow.ToString("O")+"] "+ex+Environment.NewLine);}catch{}
            Environment.ExitCode=1;
        }
    }
}

internal sealed class StartedProcess
{
    internal readonly IntPtr Handle;internal readonly uint ProcessId;
    internal StartedProcess(IntPtr handle,uint processId){Handle=handle;ProcessId=processId;}
}

internal static class PrivilegedProcess
{
    private const uint TOKEN_ASSIGN_PRIMARY=0x0001,TOKEN_DUPLICATE=0x0002,TOKEN_QUERY=0x0008,TOKEN_ADJUST_DEFAULT=0x0080,TOKEN_ADJUST_SESSIONID=0x0100,MAXIMUM_ALLOWED=0x02000000,CREATE_NO_WINDOW=0x08000000,WAIT_TIMEOUT=258;
    private const int SecurityImpersonation=2,TokenPrimary=1,TokenSessionId=12;
    internal static SecurityIdentifier GetActiveUserSid()
    {
        uint session=Native.GetActiveInteractiveSessionId();if(session==0xFFFFFFFF)throw new InvalidOperationException("interactive_session_unavailable");IntPtr token=IntPtr.Zero;
        try{if(!Native.WTSQueryUserToken(session,out token))Throw("query_interactive_user_token");using(WindowsIdentity identity=new WindowsIdentity(token)){if(identity.User==null)throw new InvalidOperationException("interactive_user_sid_unavailable");return identity.User;}}
        finally{if(token!=IntPtr.Zero)Native.CloseHandle(token);}
    }
    internal static void RunInActiveUserSession(string exe,string[] args,int timeout)
    {
        uint session=Native.GetActiveInteractiveSessionId();if(session==0xFFFFFFFF)throw new InvalidOperationException("interactive_session_unavailable");
        IntPtr token=IntPtr.Zero,process=IntPtr.Zero,thread=IntPtr.Zero;
        try
        {
            if(!Native.WTSQueryUserToken(session,out token))Throw("query_interactive_user_token");
            Native.STARTUPINFO si=new Native.STARTUPINFO();si.cb=Marshal.SizeOf(typeof(Native.STARTUPINFO));si.lpDesktop="winsta0\\default";Native.PROCESS_INFORMATION pi;
            string command=Quote(exe);foreach(string a in args)command+=" "+Quote(a);
            if(!Native.CreateProcessAsUser(token,null,command,IntPtr.Zero,IntPtr.Zero,false,CREATE_NO_WINDOW,IntPtr.Zero,Path.GetDirectoryName(exe),ref si,out pi))Throw("create_interactive_worker");process=pi.hProcess;thread=pi.hThread;
            uint wait=Native.WaitForSingleObject(process,(uint)timeout);if(wait==WAIT_TIMEOUT){Native.TerminateProcess(process,1460);throw new System.TimeoutException("interactive_worker_timeout");}
            uint exit;if(!Native.GetExitCodeProcess(process,out exit)||exit!=0)throw new InvalidOperationException("interactive_worker_failed_"+exit);
        }
        finally{if(thread!=IntPtr.Zero)Native.CloseHandle(thread);if(process!=IntPtr.Zero)Native.CloseHandle(process);if(token!=IntPtr.Zero)Native.CloseHandle(token);}
    }
    internal static StartedProcess StartInActiveSession(string exe,string[] args)
    {
        uint session=Native.GetActiveInteractiveSessionId();if(session==0xFFFFFFFF)throw new InvalidOperationException("interactive_session_unavailable");
        IntPtr source=IntPtr.Zero,token=IntPtr.Zero,process=IntPtr.Zero,thread=IntPtr.Zero;
        try
        {
            if(!Native.OpenProcessToken(Native.GetCurrentProcess(),TOKEN_ASSIGN_PRIMARY|TOKEN_DUPLICATE|TOKEN_QUERY|TOKEN_ADJUST_DEFAULT|TOKEN_ADJUST_SESSIONID,out source))Throw("open_service_token");
            if(!Native.DuplicateTokenEx(source,MAXIMUM_ALLOWED,IntPtr.Zero,SecurityImpersonation,TokenPrimary,out token))Throw("duplicate_system_token");
            int sid=unchecked((int)session);if(!Native.SetTokenInformation(token,TokenSessionId,ref sid,sizeof(int)))Throw("set_session_token");
            Native.STARTUPINFO si=new Native.STARTUPINFO();si.cb=Marshal.SizeOf(typeof(Native.STARTUPINFO));si.lpDesktop="winsta0\\default";Native.PROCESS_INFORMATION pi;
            string command=Quote(exe);foreach(string a in args)command+=" "+Quote(a);
            if(!Native.CreateProcessAsUser(token,null,command,IntPtr.Zero,IntPtr.Zero,false,CREATE_NO_WINDOW,IntPtr.Zero,Path.GetDirectoryName(exe),ref si,out pi))Throw("create_session_bridge");
            process=pi.hProcess;thread=pi.hThread;return new StartedProcess(process,pi.dwProcessId);
        }
        catch{if(process!=IntPtr.Zero)Native.CloseHandle(process);throw;}
        finally{if(thread!=IntPtr.Zero)Native.CloseHandle(thread);if(token!=IntPtr.Zero)Native.CloseHandle(token);if(source!=IntPtr.Zero)Native.CloseHandle(source);}
    }
    internal static void RunInActiveSession(string exe,string[] args,int timeout)
    {
        uint session=Native.GetActiveInteractiveSessionId();if(session==0xFFFFFFFF)throw new InvalidOperationException("interactive_session_unavailable");
        IntPtr source=IntPtr.Zero,token=IntPtr.Zero,process=IntPtr.Zero,thread=IntPtr.Zero;
        try
        {
            if(!Native.OpenProcessToken(Native.GetCurrentProcess(),TOKEN_ASSIGN_PRIMARY|TOKEN_DUPLICATE|TOKEN_QUERY|TOKEN_ADJUST_DEFAULT|TOKEN_ADJUST_SESSIONID,out source))Throw("open_service_token");
            if(!Native.DuplicateTokenEx(source,MAXIMUM_ALLOWED,IntPtr.Zero,SecurityImpersonation,TokenPrimary,out token))Throw("duplicate_system_token");
            int sid=unchecked((int)session);if(!Native.SetTokenInformation(token,TokenSessionId,ref sid,sizeof(int)))Throw("set_session_token");
            Native.STARTUPINFO si=new Native.STARTUPINFO();si.cb=Marshal.SizeOf(typeof(Native.STARTUPINFO));si.lpDesktop="winsta0\\default";Native.PROCESS_INFORMATION pi;
            string command=Quote(exe);foreach(string a in args)command+=" "+Quote(a);
            if(!Native.CreateProcessAsUser(token,null,command,IntPtr.Zero,IntPtr.Zero,false,CREATE_NO_WINDOW,IntPtr.Zero,Path.GetDirectoryName(exe),ref si,out pi))Throw("create_privileged_worker");process=pi.hProcess;thread=pi.hThread;
            uint wait=Native.WaitForSingleObject(process,(uint)timeout);if(wait==WAIT_TIMEOUT){Native.TerminateProcess(process,1460);throw new System.TimeoutException("privileged_worker_timeout");}
            uint exit;if(!Native.GetExitCodeProcess(process,out exit)||exit!=0)throw new InvalidOperationException("privileged_worker_failed_"+exit);
        }
        finally{if(thread!=IntPtr.Zero)Native.CloseHandle(thread);if(process!=IntPtr.Zero)Native.CloseHandle(process);if(token!=IntPtr.Zero)Native.CloseHandle(token);if(source!=IntPtr.Zero)Native.CloseHandle(source);}
    }
    private static string Quote(string value){return "\""+(value??"").Replace("\"","\\\"")+"\"";}
    private static void Throw(string name){throw new Win32Exception(Marshal.GetLastWin32Error(),name);}
}

internal static class Native
{
    [DllImport("sas.dll",SetLastError=true)]internal static extern void SendSAS(bool asUser);
    [DllImport("wtsapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)]internal static extern bool WTSSendMessage(IntPtr server,uint session,string title,uint titleLength,string message,uint messageLength,uint style,uint timeout,out uint response,bool wait);
    [DllImport("kernel32.dll")]internal static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll",SetLastError=true)]internal static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")]internal static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("wtsapi32.dll",SetLastError=true)]private static extern bool WTSEnumerateSessions(IntPtr server,int reserved,int version,out IntPtr sessions,out int count);
    [DllImport("wtsapi32.dll")]private static extern void WTSFreeMemory(IntPtr memory);
    [DllImport("wtsapi32.dll",SetLastError=true)]internal static extern bool WTSQueryUserToken(uint sessionId,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)]internal static extern bool OpenProcessToken(IntPtr p,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)]internal static extern bool DuplicateTokenEx(IntPtr existing,uint access,IntPtr attrs,int level,int type,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)]internal static extern bool SetTokenInformation(IntPtr token,int cls,ref int info,int length);
    [DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)]internal static extern bool CreateProcessAsUser(IntPtr token,string app,string command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO si,out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll",SetLastError=true)]internal static extern uint WaitForSingleObject(IntPtr h,uint ms);
    [DllImport("kernel32.dll",SetLastError=true)]internal static extern bool GetExitCodeProcess(IntPtr h,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)]internal static extern bool TerminateProcess(IntPtr h,uint code);
    internal static uint GetActiveInteractiveSessionId()
    {
        uint console=WTSGetActiveConsoleSessionId(),first=0xFFFFFFFF;IntPtr buffer=IntPtr.Zero;int count=0;
        try
        {
            if(WTSEnumerateSessions(IntPtr.Zero,0,1,out buffer,out count))
            {
                int size=Marshal.SizeOf(typeof(WTS_SESSION_INFO));long current=buffer.ToInt64();
                for(int i=0;i<count;i++)
                {
                    WTS_SESSION_INFO info=(WTS_SESSION_INFO)Marshal.PtrToStructure(new IntPtr(current),typeof(WTS_SESSION_INFO));
                    if(info.State==0){uint id=unchecked((uint)info.SessionId);if(id==console)return console;if(first==0xFFFFFFFF)first=id;}
                    current+=size;
                }
            }
        }
        finally{if(buffer!=IntPtr.Zero)WTSFreeMemory(buffer);}
        return first!=0xFFFFFFFF?first:console;
    }
    [StructLayout(LayoutKind.Sequential)]private struct WTS_SESSION_INFO{public int SessionId;public IntPtr WinStationName;public int State;}
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]internal struct STARTUPINFO{public int cb;public string lpReserved;public string lpDesktop;public string lpTitle;public int dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags;public short wShowWindow,cbReserved2;public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError;}
    [StructLayout(LayoutKind.Sequential)]internal struct PROCESS_INFORMATION{public IntPtr hProcess,hThread;public uint dwProcessId,dwThreadId;}
}
