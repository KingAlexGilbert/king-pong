using System;

namespace KingPongWebView2
{
    internal static class GamePagePolicy
    {
        // Compare parsed URIs, never prefixes (index.html.evil must not match).
        // Fragments are harmless; queries and UNC/network files are not allowed.
        public static bool IsAllowed(string source, Uri gameUri)
        {
            Uri candidate;
            return gameUri != null &&
                Uri.TryCreate(source, UriKind.Absolute, out candidate) &&
                candidate.IsFile && !candidate.IsUnc &&
                string.IsNullOrEmpty(candidate.Host) &&
                string.IsNullOrEmpty(candidate.Query) &&
                string.Equals(candidate.LocalPath, gameUri.LocalPath,
                    StringComparison.OrdinalIgnoreCase);
        }
    }
}
