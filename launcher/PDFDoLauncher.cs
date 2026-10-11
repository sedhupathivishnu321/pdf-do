// PDF Do - standalone launcher. Starts the local conversion service (loopback only, random port + access token) and opens the app
// as a chromeless Microsoft Edge "app window" with a private profile. When the last PDF Do window closes, the service is stopped.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("PDF Do")]
[assembly: AssemblyProduct("PDF Do")]
[assembly: AssemblyDescription("Private, offline PDF studio")]
[assembly: AssemblyCompany("VIN TECHNOLOGIES")]
[assembly: AssemblyCopyright("Copyright (c) 2026 VIN TECHNOLOGIES")]
[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]

namespace PDFDo
{
    internal static class Launcher
    {
        [STAThread]
        private static int Main(string[] args)
        {
            bool createdNew;
            using (var mutex = new System.Threading.Mutex(true, "PDFDo.SingleInstance", out createdNew))
            {
                try
                {
                    string exeDir = AppDomain.CurrentDomain.BaseDirectory;
                    string index = FindIndex(exeDir);
                    if (index == null)
                    {
                        Fail("PDF Do's application files were not found next to PDFDo.exe.\n\nExpected: " + Path.Combine(exeDir, "app", "index.html"));
                        return 2;
                    }
                    string edge = FindEdge();
                    if (edge == null)
                    {
                        Fail("PDF Do runs inside Microsoft Edge, which could not be found on this computer.\n\nInstall or repair Microsoft Edge and try again.");
                        return 3;
                    }
                    string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PDFDo");
                    string profile = Path.Combine(data, "EdgeProfile");
                    Directory.CreateDirectory(profile);
                    string infoFile = Path.Combine(data, "service.json");

                    string port = null, token = null;
                    Process service = null;
                    if (createdNew)
                    {
                        string svcExe = Path.Combine(exeDir, "service", "pdfdo-service.exe");
                        if (File.Exists(svcExe))
                        {
                            port = FreePort().ToString();
                            token = Guid.NewGuid().ToString("N");
                            var spsi = new ProcessStartInfo(svcExe, "--port " + port + " --token " + token);
                            spsi.UseShellExecute = false;
                            spsi.CreateNoWindow = true;
                            spsi.WindowStyle = ProcessWindowStyle.Hidden;
                            spsi.WorkingDirectory = Path.GetDirectoryName(svcExe);
                            try { service = Process.Start(spsi); File.WriteAllText(infoFile, port + "\n" + token); }
                            catch { service = null; port = null; token = null; }
                        }
                    }
                    else if (File.Exists(infoFile))
                    {
                        var lines = File.ReadAllText(infoFile).Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
                        if (lines.Length >= 2) { port = lines[0].Trim(); token = lines[1].Trim(); }
                    }

                    string url = new Uri(index).AbsoluteUri;
                    var q = new StringBuilder();
                    if (port != null) q.Append("svc=").Append(port).Append("&tok=").Append(token);
                    if (args.Length > 0 && File.Exists(args[0]))
                    {
                        if (q.Length > 0) q.Append("&");
                        q.Append("open=").Append(Uri.EscapeDataString(Path.GetFullPath(args[0])));
                    }
                    if (q.Length > 0) url += "?" + q;

                    var sb = new StringBuilder();
                    sb.Append("--app=\"").Append(url).Append("\" ");
                    sb.Append("--user-data-dir=\"").Append(profile).Append("\" ");
                    sb.Append("--allow-file-access-from-files ");
                    sb.Append("--no-first-run --no-default-browser-check --disable-sync ");
                    sb.Append("--disable-features=Translate,msEdgeShopping,msEdgeAssist,HubsSidebar ");
                    sb.Append("--disable-extensions --disable-component-update --disable-background-networking ");
                    sb.Append("--window-size=1440,900 --lang=en-US");

                    if (service != null) WaitForService(port, token, 45);

                    var psi = new ProcessStartInfo(edge, sb.ToString());
                    psi.UseShellExecute = false;
                    psi.WorkingDirectory = Path.GetDirectoryName(index);
                    Process.Start(psi);

                    if (createdNew && service != null)
                    {
                        // stay alive while any PDF Do window is open, then stop the service and clean up temp files
                        System.Threading.Thread.Sleep(4000);
                        while (EdgeRunning(profile)) System.Threading.Thread.Sleep(1500);
                        try { if (!service.HasExited) service.Kill(); } catch { }
                        try { File.Delete(infoFile); } catch { }
                        try { Directory.Delete(Path.Combine(data, "tmp"), true); } catch { }
                    }
                    return 0;
                }
                catch (Exception ex)
                {
                    Fail("PDF Do could not start:\n\n" + ex.Message);
                    return 1;
                }
            }
        }

        private static int FreePort()
        {
            var l = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
            l.Start();
            int p = ((System.Net.IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return p;
        }

        private static void WaitForService(string port, string token, int seconds)
        {
            var end = DateTime.UtcNow.AddSeconds(seconds);
            while (DateTime.UtcNow < end)
            {
                try
                {
                    var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                    req.Headers.Add("X-PDFDo-Token", token);
                    req.Timeout = 1500;
                    using (var r = (System.Net.HttpWebResponse)req.GetResponse()) { if ((int)r.StatusCode == 200) return; }
                }
                catch { }
                System.Threading.Thread.Sleep(400);
            }
        }

        private static bool EdgeRunning(string profile)
        {
            try
            {
                using (var s = new System.Management.ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name='msedge.exe'"))
                    foreach (System.Management.ManagementObject o in s.Get())
                    {
                        var c = o["CommandLine"] as string;
                        if (c != null && c.IndexOf(@"PDFDo\EdgeProfile", StringComparison.OrdinalIgnoreCase) >= 0) return true;
                    }
            }
            catch { return true; }
            return false;
        }

        private static string FindIndex(string exeDir)
        {
            string[] candidates =
            {
                Path.Combine(exeDir, "app", "index.html"),
                Path.Combine(exeDir, "index.html"),
                Path.GetFullPath(Path.Combine(exeDir, "..", "index.html")),
            };
            foreach (string c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        private static string FindEdge()
        {
            foreach (var root in new[] { Registry.LocalMachine, Registry.CurrentUser })
            {
                try
                {
                    using (var k = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                    {
                        string p = k == null ? null : k.GetValue(null) as string;
                        if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
                    }
                }
                catch { }
            }
            string[] known =
            {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) + @"\Microsoft\Edge\Application\msedge.exe",
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) + @"\Microsoft\Edge\Application\msedge.exe",
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) + @"\Microsoft\Edge\Application\msedge.exe",
            };
            foreach (string k in known) if (File.Exists(k)) return k;
            return null;
        }

        private static void Fail(string message)
        {
            MessageBox.Show(message, "PDF Do", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
