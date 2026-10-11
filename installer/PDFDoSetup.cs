// PDF Do - single-file installer / uninstaller. The application payload (a ZIP) is appended to this executable;
// the last 16 bytes are: payload length (int64) + magic "PDFDOPAY". Per-user install, no admin rights needed.
//   PDFDoSetup.exe              install (or update)
//   PDFDoSetup.exe /uninstall   remove
//   PDFDoSetup.exe /silent      install without UI prompts
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("PDF Do Setup")]
[assembly: AssemblyProduct("PDF Do")]
[assembly: AssemblyCompany("VIN TECHNOLOGIES")]
[assembly: AssemblyCopyright("Copyright (c) 2026 VIN TECHNOLOGIES")]
[assembly: AssemblyVersion("1.1.0.0")]

namespace PDFDoSetup
{
    internal sealed class OffsetStream : Stream
    {
        private readonly Stream _s; private readonly long _off, _len;
        public OffsetStream(Stream s, long off, long len) { _s = s; _off = off; _len = len; _s.Position = off; }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return _len; } }
        public override long Position { get { return _s.Position - _off; } set { _s.Position = _off + value; } }
        public override void Flush() { }
        public override int Read(byte[] b, int o, int c) { long left = _len - Position; if (left <= 0) return 0; return _s.Read(b, o, (int)Math.Min(c, left)); }
        public override long Seek(long off, SeekOrigin origin)
        {
            long p = origin == SeekOrigin.Begin ? off : origin == SeekOrigin.Current ? Position + off : _len + off;
            Position = p; return p;
        }
        public override void SetLength(long v) { throw new NotSupportedException(); }
        public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
    }

    internal static class Program
    {
        static readonly string Dest = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "PDFDo");
        static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PDFDo");

        [STAThread]
        static int Main(string[] args)
        {
            bool uninstall = Array.IndexOf(args, "/uninstall") >= 0;
            bool silent = Array.IndexOf(args, "/silent") >= 0;
            Application.EnableVisualStyles();
            try
            {
                string self = Assembly.GetExecutingAssembly().Location;
                if (Path.GetFileNameWithoutExtension(self).ToLowerInvariant().IndexOf("portable") >= 0 || Array.IndexOf(args, "/portable") >= 0)
                    return RunPortable(self, args);
                if (uninstall) return Uninstall(silent);
                return Install(silent);
            }
            catch (Exception ex)
            {
                MessageBox.Show("PDF Do setup failed:\n\n" + ex.Message, "PDF Do Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        // Portable: unpack once into %LOCALAPPDATA%\PDFDo\portable\<payload id>, then run PDFDo.exe from there (no install, no admin).
        static int RunPortable(string self, string[] args)
        {
            long len;
            using (var fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                long fend;
                if (!ReadFooter(fs, out len, out fend)) throw new InvalidOperationException("This file has no payload.");
            }
            string dest = Path.Combine(DataDir, "portable", len.ToString());
            string exe = Path.Combine(dest, "PDFDo.exe");
            if (!File.Exists(exe))
            {
                string parent = Path.Combine(DataDir, "portable");
                if (Directory.Exists(parent)) { try { Directory.Delete(parent, true); } catch { } }   // drop older cached versions
                Install(false, dest, true);
            }
            var forward = new System.Collections.Generic.List<string>();
            foreach (var a in args) if (a != "/portable" && a != "/silent") forward.Add("\"" + a + "\"");
            var psi = new ProcessStartInfo(exe, string.Join(" ", forward.ToArray())) { UseShellExecute = false, WorkingDirectory = dest };
            Process.Start(psi);
            return 0;
        }

        // The payload footer (16 bytes: length + "PDFDOPAY") normally ends the file. After Authenticode signing a certificate table
        // follows it (plus up to 7 padding bytes), so the footer is looked up just before the certificate table when one exists.
        static bool ReadFooter(FileStream fs, out long payloadLen, out long footerEnd)
        {
            long end = fs.Length;
            var hdr = new byte[0x400];
            fs.Seek(0, SeekOrigin.Begin); int n = fs.Read(hdr, 0, hdr.Length);
            if (n > 0x40 && hdr[0] == 'M' && hdr[1] == 'Z')
            {
                int pe = BitConverter.ToInt32(hdr, 0x3C);
                if (pe > 0 && pe + 0x98 < n && hdr[pe] == 'P' && hdr[pe + 1] == 'E')
                {
                    int opt = pe + 24; int magic = BitConverter.ToUInt16(hdr, opt);
                    int dir = opt + (magic == 0x20b ? 0x70 : 0x60) + 4 * 8;         // data directory #4 = certificate table
                    uint certOff = BitConverter.ToUInt32(hdr, dir);
                    if (certOff > 0 && certOff < end) end = certOff;
                }
            }
            for (int pad = 0; pad <= 8; pad++)
            {
                long pos = end - pad - 16;
                if (pos < 0) break;
                fs.Seek(pos, SeekOrigin.Begin);
                var tail = new byte[16]; fs.Read(tail, 0, 16);
                if (Encoding.ASCII.GetString(tail, 8, 8) == "PDFDOPAY") { payloadLen = BitConverter.ToInt64(tail, 0); footerEnd = pos + 16; return true; }
            }
            payloadLen = 0; footerEnd = 0; return false;
        }

        static void StopRunning()
        {
            foreach (var n in new[] { "PDFDo", "pdfdo-service" })
                foreach (var p in Process.GetProcessesByName(n)) { try { p.Kill(); p.WaitForExit(3000); } catch { } }
        }

        static int Install(bool silent, string dest = null, bool portable = false, string[] launchArgs = null)
        {
            if (dest == null) dest = Dest;
            string self = Assembly.GetExecutingAssembly().Location;
            long payloadLen; long payloadStart;
            using (var fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                long fend;
                if (!ReadFooter(fs, out payloadLen, out fend)) throw new InvalidOperationException("This setup file has no payload (it was not built with build-setup.ps1).");
                payloadStart = fend - 16 - payloadLen;
            }
            Form form = null; Label lbl = null; ProgressBar bar = null;
            if (!silent)
            {
                form = new Form { Text = portable ? "PDF Do" : "PDF Do Setup", Width = 520, Height = 190, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, BackColor = Color.White };
                try { form.Icon = Icon.ExtractAssociatedIcon(self); } catch { }
                var title = new Label { Text = portable ? "Preparing PDF Do (first run only)" : "Installing PDF Do", Font = new Font("Segoe UI", 15f, FontStyle.Bold), Left = 24, Top = 18, Width = 460, Height = 32 };
                lbl = new Label { Text = "Preparing…", Left = 24, Top = 62, Width = 460, Height = 22, Font = new Font("Segoe UI", 9.5f) };
                bar = new ProgressBar { Left = 24, Top = 92, Width = 458, Height = 18, Minimum = 0, Maximum = 1000 };
                form.Controls.AddRange(new Control[] { title, lbl, bar });
                form.Show(); Application.DoEvents();
            }
            Action<string, int> report = (t, v) => { if (form == null) return; lbl.Text = t; bar.Value = Math.Max(0, Math.Min(1000, v)); Application.DoEvents(); };

            report("Closing running copies…", 5);
            StopRunning();
            if (Directory.Exists(dest)) { try { Directory.Delete(dest, true); } catch { } }
            Directory.CreateDirectory(dest);

            using (var fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var os = new OffsetStream(fs, payloadStart, payloadLen))
            using (var zip = new ZipArchive(os, ZipArchiveMode.Read))
            {
                int n = zip.Entries.Count, i = 0;
                foreach (var e in zip.Entries)
                {
                    i++;
                    string target = Path.GetFullPath(Path.Combine(dest, e.FullName));
                    if (!target.StartsWith(dest, StringComparison.OrdinalIgnoreCase)) continue;   // zip-slip guard
                    if (e.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (var src = e.Open()) using (var dst = new FileStream(target, FileMode.Create, FileAccess.Write)) src.CopyTo(dst);
                    if (i % 25 == 0) report("Copying files… " + (i * 100 / n) + "%", 20 + (int)(i * 700L / n));
                }
            }
            if (portable) { report("Starting…", 1000); if (form != null) form.Close(); return 0; }
            report("Creating shortcuts…", 760);
            string exe = Path.Combine(dest, "PDFDo.exe");
            string icon = Path.Combine(dest, "app", "assets", "logo.ico");
            MakeShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "PDF Do.lnk"), exe, icon);
            MakeShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "PDF Do.lnk"), exe, icon);
            report("Registering…", 860);
            Register(exe, icon);
            report("Done", 1000);
            if (form != null) { form.Close(); }
            if (!silent)
            {
                var r = MessageBox.Show("PDF Do was installed.\n\nA shortcut was added to your Desktop and Start menu. You can also right-click any PDF > Open with > PDF Do.\n\nStart PDF Do now?", "PDF Do Setup", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (r == DialogResult.Yes) Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false });
            }
            return 0;
        }

        static void MakeShortcut(string lnk, string target, string icon)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            dynamic sh = Activator.CreateInstance(t);
            dynamic s = sh.CreateShortcut(lnk);
            s.TargetPath = target; s.WorkingDirectory = Path.GetDirectoryName(target); s.IconLocation = icon + ",0"; s.Description = "PDF Do - private PDF studio";
            s.Save();
        }

        static void Register(string exe, string icon)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Applications\PDFDo.exe"))
            {
                k.SetValue("FriendlyAppName", "PDF Do");
                using (var c = k.CreateSubKey(@"shell\open\command")) c.SetValue("", "\"" + exe + "\" \"%1\"");
                using (var st = k.CreateSubKey("SupportedTypes")) st.SetValue(".pdf", "");
                using (var di = k.CreateSubKey("DefaultIcon")) di.SetValue("", icon);
            }
            Registry.CurrentUser.CreateSubKey(@"Software\Classes\.pdf\OpenWithList\PDFDo.exe").Close();
            using (var u = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\PDFDo"))
            {
                u.SetValue("DisplayName", "PDF Do"); u.SetValue("DisplayVersion", "1.1.0"); u.SetValue("Publisher", "VIN TECHNOLOGIES");
                u.SetValue("DisplayIcon", icon); u.SetValue("InstallLocation", Dest);
                string setup = Path.Combine(Dest, "Uninstall PDF Do.exe");
                u.SetValue("UninstallString", "\"" + setup + "\" /uninstall");
                u.SetValue("NoModify", 1, RegistryValueKind.DWord); u.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        static int Uninstall(bool silent)
        {
            if (!silent && MessageBox.Show("Remove PDF Do from this computer?", "PDF Do Setup", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
            StopRunning();
            foreach (var f in new[] { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "PDF Do.lnk"), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "PDF Do.lnk") })
                try { File.Delete(f); } catch { }
            foreach (var k in new[] { @"Software\Classes\Applications\PDFDo.exe", @"Software\Classes\.pdf\OpenWithList\PDFDo.exe", @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PDFDo" })
                try { Registry.CurrentUser.DeleteSubKeyTree(k, false); } catch { }
            bool wipe = !silent && MessageBox.Show("Also delete your saved preferences, recent files and added fonts?", "PDF Do Setup", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
            if (wipe) { try { Directory.Delete(DataDir, true); } catch { } }
            // the running uninstaller lives inside the install folder: delete it after we exit
            string cmd = "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + Dest + "\"";
            Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = false });
            if (!silent) MessageBox.Show("PDF Do was removed.", "PDF Do Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
    }
}
