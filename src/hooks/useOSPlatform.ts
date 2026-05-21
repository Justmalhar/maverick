import { useEffect, useState } from "react";

export type OSPlatform = "macos" | "windows" | "linux";

function detect(): OSPlatform {
  if (typeof navigator === "undefined") return "macos";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  return "linux";
}

export function useOSPlatform(): OSPlatform {
  const [platform, setPlatform] = useState<OSPlatform>(() => detect());

  useEffect(() => {
    setPlatform(detect());
  }, []);

  return platform;
}
