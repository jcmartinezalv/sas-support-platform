using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading;

public sealed class SasServiceHost : ServiceBase
{
    private readonly string nodeExe, script, projectDir, envFile, outLog, errLog;
    private readonly object sync = new object();
    private Process child;
    private volatile bool isStopping;
    private int restartDelaySeconds = 2;
    private DateTime childStartedAt;

    public SasServiceHost(string name, string displayName, string nodeExe, string script, string projectDir, string envFile, string outLog, string errLog)
    {
        ServiceName = name; CanStop = true; CanShutdown = true; AutoLog = false;
        this.nodeExe=nodeExe; this.script=script; this.projectDir=projectDir; this.envFile=envFile; this.outLog=outLog; this.errLog=errLog;
    }

    protected override void OnStart(string[] args)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(outLog));
        lock(sync) { isStopping=false; StartChild(); }
    }

    private void StartChild()
    {
        if(isStopping) return;
        if(!File.Exists(nodeExe)) throw new FileNotFoundException("No existe el runtime Node.", nodeExe);
        bool rawArguments=script.StartsWith("--",StringComparison.Ordinal);
        if(!rawArguments&&!File.Exists(script)) throw new FileNotFoundException("No existe el script del servicio.", script);
        var childArguments=rawArguments?script:"\""+script+"\"";
        var psi = new ProcessStartInfo(nodeExe, childArguments) { WorkingDirectory=projectDir, UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true };
        foreach (var kv in ReadEnv(envFile)) psi.EnvironmentVariables[kv.Key]=kv.Value;
        var started = new Process { StartInfo=psi, EnableRaisingEvents=true };
        started.OutputDataReceived += (s,e)=>{ if(e.Data!=null) Append(outLog,e.Data); };
        started.ErrorDataReceived += (s,e)=>{ if(e.Data!=null) Append(errLog,e.Data); };
        started.Exited += (s,e)=>HandleExit((Process)s);
        started.Start(); started.BeginOutputReadLine(); started.BeginErrorReadLine();
        child=started; childStartedAt=DateTime.UtcNow;
    }

    private void HandleExit(Process exited)
    {
        int delay;
        lock(sync)
        {
            if(isStopping || child!=exited) { exited.Dispose(); return; }
            var lived=(DateTime.UtcNow-childStartedAt).TotalSeconds;
            if(lived>=60) restartDelaySeconds=2;
            delay=restartDelaySeconds;
            restartDelaySeconds=Math.Min(60, restartDelaySeconds*2);
            Append(errLog,"El proceso terminó. Reintento en "+delay+" segundos.");
        }
        ThreadPool.QueueUserWorkItem(_=>{
            Thread.Sleep(delay*1000);
            lock(sync)
            {
                if(isStopping || child!=exited) { exited.Dispose(); return; }
                exited.Dispose(); child=null;
                try { StartChild(); } catch(Exception ex) { Append(errLog,ex.ToString()); ScheduleRetryAfterStartFailure(); }
            }
        });
    }

    private void ScheduleRetryAfterStartFailure()
    {
        if(isStopping) return;
        var delay=restartDelaySeconds;
        restartDelaySeconds=Math.Min(60,restartDelaySeconds*2);
        ThreadPool.QueueUserWorkItem(_=>{Thread.Sleep(delay*1000);lock(sync){if(!isStopping&&child==null){try{StartChild();}catch(Exception ex){Append(errLog,ex.ToString());ScheduleRetryAfterStartFailure();}}}});
    }

    protected override void OnStop()
    {
        Process current;
        lock(sync) { isStopping=true; current=child; child=null; }
        if(current!=null)
        {
            try { if(!current.HasExited) Process.Start(new ProcessStartInfo("taskkill.exe", "/PID "+current.Id+" /T /F") { UseShellExecute=false, CreateNoWindow=true }).WaitForExit(10000); } catch {}
            try { current.Dispose(); } catch {}
        }
    }
    protected override void OnShutdown() { OnStop(); base.OnShutdown(); }
    static void Append(string path,string text) { try { File.AppendAllText(path,"["+DateTime.Now.ToString("o")+"] "+text+Environment.NewLine); } catch {} }
    static Dictionary<string,string> ReadEnv(string path) { var d=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase); if(!File.Exists(path)) return d; foreach(var line in File.ReadAllLines(path)) { var t=line.Trim(); if(t.Length==0||t.StartsWith("#")) continue; var i=t.IndexOf('='); if(i>0) d[t.Substring(0,i).Trim()]=t.Substring(i+1).Trim(); } return d; }
    public static void Main(string[] a) { if(a.Length<8) throw new ArgumentException("serviceName displayName nodeExe script projectDir envFile outLog errLog"); ServiceBase.Run(new SasServiceHost(a[0],a[1],a[2],a[3],a[4],a[5],a[6],a[7])); }
}
