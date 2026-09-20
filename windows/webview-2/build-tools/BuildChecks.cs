using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Xml;
using KingPongWebView2;

internal static class BuildChecks
{
    private const string ExeName = "KingPong-Desktop-HD-WebView2.exe";

    private static int Main(string[] args)
    {
        try
        {
            // Probe compatibility before the launchers start the app build.
            if (args.Length == 2 && args[0] == "--check-protocol" && args[1] == "2")
                return 0;
            TestPolicy();
            TestVersionChecks();
            if (args.Length == 5 && args[0] == "--package")
                Package(args[1], args[2], args[3], args[4]);
            else if (args.Length == 3 && args[0] == "--measure")
                Measure(args[1], args[2]);
            else if (args.Length != 0)
                throw new ArgumentException("Usage: --check-protocol 2, --package SOURCE PUBLISH STAGE VERSION, --measure FILE VERSION, or no arguments for self-tests.");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("BUILD CHECK FAILED: " + error.Message);
            return 1;
        }
    }

    private static void TestPolicy()
    {
        var game = new Uri("file:///C:/Games/King%20Pong/index.html");
        string[] allowed = {
            "file:///C:/Games/King%20Pong/index.html",
            "file:///C:/Games/King%20Pong/index.html#menu",
            "file:///c:/games/king%20pong/INDEX.HTML"
        };
        string[] blocked = {
            "file:///C:/Games/King%20Pong/index.html?other=1",
            "file:///C:/Games/King%20Pong/index.html.evil",
            "file:///C:/Games/King%20Pong/other.html",
            "file:///C:/Games/King%20Pong/../index.html",
            "file:///C:/Games/King%20Pong/index.html/child",
            "file:///C:/Other/index.html",
            "file://server/share/index.html",
            "https://example.com/index.html",
            "https://example.com/file:///C:/Games/King%20Pong/index.html",
            "about:blank", "data:text/html,hello", "javascript:void(0)",
            "index.html", "", null
        };
        foreach (string source in allowed)
            if (!GamePagePolicy.IsAllowed(source, game))
                throw new InvalidOperationException("Trusted game URI rejected: " + source);
        foreach (string source in blocked)
            if (GamePagePolicy.IsAllowed(source, game))
                throw new InvalidOperationException("Untrusted URI allowed: " + source);
        if (GamePagePolicy.IsAllowed(game.AbsoluteUri, null))
            throw new InvalidOperationException("A missing trusted URI must fail closed.");
        Console.WriteLine("URI policy: " + (allowed.Length + blocked.Length + 1) + " checks passed.");
    }

    private static void Package(string source, string publish, string stage, string expectedVersion)
    {
        // Catch mixed copies of the new launchers and an older source project.
        var project = new XmlDocument { XmlResolver = null };
        project.Load(Path.Combine(source, "KingPongWebView2.csproj"));
        string sourceVersion = project.SelectSingleNode("/Project/PropertyGroup/Version")?.InnerText.Trim();
        if (sourceVersion != expectedVersion)
            throw new InvalidOperationException("The source project version is " + sourceVersion +
                ", but this launcher expects " + expectedVersion + ". Extract both complete folders from the updated ZIP.");
        string appPath = Path.Combine(publish, ExeName);
        Version numericVersion = CheckVersion(appPath, expectedVersion);
        if (!numericVersion.Equals(AssemblyName.GetAssemblyName(appPath).Version))
            throw new InvalidOperationException("The app assembly version does not match " + numericVersion + ": " + appPath);
        if (Directory.GetFileSystemEntries(stage).Length != 0)
            throw new InvalidOperationException("Staging directory must be empty.");
        string[] required = {
            ExeName, ExeName + ".config", "Microsoft.Web.WebView2.Core.dll",
            "Microsoft.Web.WebView2.WinForms.dll", "index.html", "README.txt"
        };
        foreach (string name in required)
        {
            string path = Path.Combine(publish, name);
            RequireFile(path);
            File.Copy(path, Path.Combine(stage, name));
        }
        string loader = new[] {
            "WebView2Loader.dll", @"runtimes\win-x64\native\WebView2Loader.dll",
            @"x64\WebView2Loader.dll"
        }.Select(relative => Path.Combine(publish, relative))
            .FirstOrDefault(path => File.Exists(path) && ReadPeMachine(path) == 0x8664);
        if (loader == null) throw new InvalidOperationException("An x64 WebView2Loader.dll is missing.");
        File.Copy(loader, Path.Combine(stage, "WebView2Loader.dll"));
        if (ReadPeMachine(Path.Combine(stage, ExeName)) != 0x8664)
            throw new InvalidOperationException("The app EXE is not x64.");
        if (Hash(Path.Combine(source, "index.html")) != Hash(Path.Combine(stage, "index.html")))
            throw new InvalidOperationException("Packaged HTML differs from source.");
        string[] files = Directory.GetFiles(stage);
        if (files.Length != 7 || Directory.GetDirectories(stage).Length != 0)
            throw new InvalidOperationException("Unexpected payload; expected exactly seven files.");
        Console.WriteLine("Validated portable payload: {0:N0} bytes in 7 files.",
            files.Sum(path => new FileInfo(path).Length));
    }

    private static ushort ReadPeMachine(string path)
    {
        using (var stream = File.OpenRead(path))
        using (var reader = new BinaryReader(stream))
        {
            if (reader.ReadUInt16() != 0x5A4D) throw new InvalidDataException("Missing MZ header: " + path);
            stream.Position = 0x3C;
            int offset = reader.ReadInt32();
            if (offset < 64 || offset > stream.Length - 6) throw new InvalidDataException("Invalid PE offset: " + path);
            stream.Position = offset;
            if (reader.ReadUInt32() != 0x00004550) throw new InvalidDataException("Missing PE header: " + path);
            return reader.ReadUInt16();
        }
    }

    private static void RequireFile(string path)
    {
        if (!File.Exists(path) || new FileInfo(path).Length == 0)
            throw new FileNotFoundException("Missing or empty build file: " + path);
    }

    private static string Hash(string path)
    {
        using (var stream = File.OpenRead(path))
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
    }

    private static Version CheckVersion(string path, string expectedVersion)
    {
        RequireFile(path);
        FileVersionInfo info = FileVersionInfo.GetVersionInfo(path);
        var fileVersion = new Version(info.FileMajorPart, info.FileMinorPart, info.FileBuildPart, info.FilePrivatePart);
        var productVersion = new Version(info.ProductMajorPart, info.ProductMinorPart, info.ProductBuildPart, info.ProductPrivatePart);
        RequireVersion(path, info.ProductVersion, fileVersion, productVersion, expectedVersion);
        Console.WriteLine("Verified version: {0} (file {1}) - {2}", expectedVersion, fileVersion, path);
        return fileVersion;
    }

    private static void RequireVersion(string path, string productText, Version fileVersion, Version productVersion, string expectedVersion)
    {
        var numericVersion = new Version(expectedVersion + ".0");
        // Version-resource strings can have trailing space/NUL padding. Remove
        // only that padding; keep leading/internal characters and Git suffixes.
        string versionText = (productText ?? string.Empty).TrimEnd(' ', '\0');
        if (!string.Equals(versionText, expectedVersion, StringComparison.Ordinal) ||
            !numericVersion.Equals(fileVersion) || !numericVersion.Equals(productVersion))
            throw new InvalidOperationException("Wrong version in " + path + ". Expected product " + expectedVersion +
                " and numeric versions " + numericVersion + "; found product '" + versionText +
                "' after removing trailing padding, file " + fileVersion + ", numeric product " + productVersion +
                ". Build stopped before publishing this release.");
    }

    private static void TestVersionChecks()
    {
        string[] valid = {
            "1.1.3",
            "1.1.3".PadRight(64, ' '),
            "1.1.3\0\0",
            "1.1.3 \0 \0"
        };
        foreach (string productText in valid)
            RequireVersion("valid fixture", productText, new Version("1.1.3.0"), new Version("1.1.3.0"), "1.1.3");
        string[][] invalid = {
            new[] { "1.1.2+40ab123", "1.1.2.0", "1.1.2.0" },
            new[] { "1.1.3+40ab123", "1.1.3.0", "1.1.3.0" },
            new[] { "1.1.2", "1.1.3.0", "1.1.3.0" },
            new[] { "1.1.3", "1.1.2.0", "1.1.3.0" },
            new[] { "1.1.3", "1.1.3.0", "1.1.2.0" },
            new[] { "", "0.0.0.0", "0.0.0.0" },
            new[] { "1.1.2   \0", "1.1.3.0", "1.1.3.0" },
            new[] { "1.1.3+40ab123   \0", "1.1.3.0", "1.1.3.0" },
            new[] { "1.1.3\0+40ab123", "1.1.3.0", "1.1.3.0" },
            new[] { " 1.1.3", "1.1.3.0", "1.1.3.0" },
            new[] { " \0 \0", "1.1.3.0", "1.1.3.0" },
            new[] { null, "1.1.3.0", "1.1.3.0" }
        };
        foreach (string[] sample in invalid)
        {
            bool rejected = false;
            try { RequireVersion("invalid fixture", sample[0], new Version(sample[1]), new Version(sample[2]), "1.1.3"); }
            catch (InvalidOperationException) { rejected = true; }
            if (!rejected) throw new InvalidOperationException("Version self-test accepted invalid metadata: " + sample[0]);
        }
        Console.WriteLine("Version validation: " + (valid.Length + invalid.Length) + " checks passed.");
    }

    private static void Measure(string path, string expectedVersion)
    {
        CheckVersion(path, expectedVersion);
        ReadPeMachine(path);
        Console.WriteLine("Installer size: {0:N0} bytes", new FileInfo(path).Length);
        Console.WriteLine("Installer SHA256: " + Hash(path));
    }
}
