import Image from "next/image";

export function Logo({
  size = 28,
  withWordmark = true,
  className = "",
  dark = false,
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
  /** true when rendered on a light background (navy mark + dark wordmark) */
  dark?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Image
        src={dark ? "/logo-icon.png" : "/logo-icon-on-dark.png"}
        alt="MedVerse"
        width={size}
        height={size}
        priority
      />
      {withWordmark && (
        <span
          className={`text-lg font-bold tracking-tight ${
            dark ? "text-[#072855]" : "text-white"
          }`}
        >
          Med<span className="text-[#05AEA9]">Verse</span>
        </span>
      )}
    </div>
  );
}
