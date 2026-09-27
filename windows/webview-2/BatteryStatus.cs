using System.Globalization;

namespace KingPongWebView2
{
    internal static class BatteryStatus
    {
        internal static string UpdateScript(bool readSucceeded, byte flags, byte percentage, byte acLine)
        {
            // 255 means unknown; it must be checked before testing the 128 bit.
            bool? present = readSucceeded && flags != 255 ? (bool?)((flags & 128) == 0) : null;
            int level = readSucceeded && present != false && percentage <= 100 ? percentage : -1;
            bool charging = present == true && ((flags & 8) != 0 || (level == 100 && acLine == 1));
            string presence = present.HasValue ? (present.Value ? "true" : "false") : "null";
            return "window.KingPongBattery && window.KingPongBattery.update("
                + level.ToString(CultureInfo.InvariantCulture) + "," + (charging ? "true" : "false")
                + "," + presence + ");";
        }
    }
}
