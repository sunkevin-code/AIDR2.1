using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading;

public sealed class AIDRServiceHost : ServiceBase
{
    private static string[] startupArgs;
    private Process child;
    private string endpointPath;
    private string endpointArguments;
    private Timer watchdog;
    private readonly object gate = new object();

    public AIDRServiceHost()
    {
        ServiceName = "AIDR Endpoint";
        CanStop = true;
        CanPauseAndContinue = false;
        AutoLog = false;
    }

    protected override void OnStart(string[] args)
    {
        if (args == null || args.Length == 0) args = startupArgs;
        Log("OnStart args=" + (args == null ? "<null>" : String.Join(" | ", args)));
        if (args == null || args.Length == 0) throw new InvalidOperationException("Endpoint path is missing.");
        endpointPath = args[0];
        endpointArguments = JoinArguments(args, 1);
        StartChild();
        watchdog = new Timer(WatchdogTick, null, 3000, 3000);
        Log("Child started pid=" + (child == null ? "<null>" : child.Id.ToString()) + " path=" + endpointPath + " args=" + endpointArguments);
    }

    protected override void OnStop()
    {
        Log("OnStop");
        if (watchdog != null) watchdog.Dispose();
        lock (gate)
        {
            if (child == null) return;
            try
            {
                if (!child.HasExited)
                {
                    var killer = Process.Start(new ProcessStartInfo
                    {
                        FileName = "taskkill.exe",
                        Arguments = "/PID " + child.Id + " /T /F",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    });
                    if (killer != null) killer.WaitForExit(5000);
                }
                child.WaitForExit(5000);
            }
            catch { }
            finally
            {
                child.Dispose();
                child = null;
            }
        }
    }

    private void WatchdogTick(object state)
    {
        lock (gate)
        {
            if (child == null || child.HasExited)
            {
                Log("Watchdog restarting child");
                StartChild();
            }
        }
    }

    private void StartChild()
    {
        if (String.IsNullOrWhiteSpace(endpointPath) || !File.Exists(endpointPath))
            throw new FileNotFoundException("AIDR Endpoint executable was not found.", endpointPath);
        var info = new ProcessStartInfo
        {
            FileName = endpointPath,
            Arguments = endpointArguments,
            WorkingDirectory = Path.GetDirectoryName(endpointPath),
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        info.EnvironmentVariables["AIDR_ENDPOINT_HOME"] = Path.GetDirectoryName(endpointPath);
        if (startupArgs != null && startupArgs.Length > 2)
        {
            info.EnvironmentVariables["AIDR_CODEX_HOME"] = startupArgs[2];
            info.EnvironmentVariables["USERPROFILE"] = startupArgs[2];
        }
        child = Process.Start(info);
    }

    private static void Log(string message)
    {
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AIDR");
            Directory.CreateDirectory(directory);
            File.AppendAllText(Path.Combine(directory, "service-host.log"), DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine);
        }
        catch { }
    }

    private static string JoinArguments(string[] args, int start)
    {
        var result = "";
        for (var i = start; i < args.Length; i++)
        {
            if (i > start) result += " ";
            result += Quote(args[i]);
        }
        return result;
    }

    private static string Quote(string value)
    {
        if (value == null) return "\"\"";
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    public static void Main(string[] args)
    {
        startupArgs = args;
        Log("Main args=" + (args == null ? "<null>" : String.Join(" | ", args)));
        try { ServiceBase.Run(new AIDRServiceHost()); }
        catch (Exception error)
        {
            try
            {
                var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AIDR");
                Directory.CreateDirectory(directory);
                File.AppendAllText(Path.Combine(directory, "service-host.log"), DateTime.UtcNow.ToString("o") + " FATAL " + error + Environment.NewLine);
            }
            catch { }
            Environment.Exit(1);
        }
    }
}
