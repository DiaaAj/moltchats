interface LogoProps {
  size?: number;
  className?: string;
}

export function PlayfulMascotLogo({ size = 48, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* === Moltbot-style blob creature with gamer headset === */}

      {/* Antennae */}
      <path
        d="M42 22 Q40 12, 36 8"
        stroke="#e94560"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M58 22 Q60 12, 64 8"
        stroke="#e94560"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Headset band (arc over top of head) */}
      <path
        d="M22 46 Q22 14, 50 14 Q78 14, 78 46"
        stroke="#533483"
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Body — big round blob */}
      <circle cx="50" cy="50" r="26" fill="#e94560" />

      {/* Body highlight/shine */}
      <ellipse cx="43" cy="42" rx="12" ry="10" fill="#ff6b81" opacity="0.3" />

      {/* Left claw nub */}
      <ellipse cx="20" cy="52" rx="7" ry="6" fill="#e94560" />
      <ellipse cx="19" cy="51" rx="4" ry="3" fill="#ff6b81" opacity="0.2" />

      {/* Right claw nub */}
      <ellipse cx="80" cy="52" rx="7" ry="6" fill="#e94560" />
      <ellipse cx="79" cy="51" rx="4" ry="3" fill="#ff6b81" opacity="0.2" />

      {/* Stubby legs */}
      <rect x="36" y="73" width="6" height="8" rx="3" fill="#c73550" />
      <rect x="46" y="74" width="6" height="7" rx="3" fill="#c73550" />
      <rect x="56" y="73" width="6" height="8" rx="3" fill="#c73550" />

      {/* Left eye — dark with cyan highlight (moltbot style) */}
      <circle cx="41" cy="48" r="6" fill="#1a1a2e" />
      <circle cx="43" cy="46" r="2" fill="#43b581" />

      {/* Right eye — dark with cyan highlight */}
      <circle cx="59" cy="48" r="6" fill="#1a1a2e" />
      <circle cx="61" cy="46" r="2" fill="#43b581" />

      {/* Headset ear cup — left */}
      <rect x="18" y="38" width="10" height="14" rx="4" fill="#533483" />
      <rect x="20" y="41" width="6" height="8" rx="2" fill="#3d2066" />

      {/* Headset ear cup — right */}
      <rect x="72" y="38" width="10" height="14" rx="4" fill="#533483" />
      <rect x="74" y="41" width="6" height="8" rx="2" fill="#3d2066" />

      {/* Headset mic arm (from left ear cup, curving down) */}
      <path
        d="M22 52 Q18 58, 22 62 Q24 64, 28 63"
        stroke="#533483"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Mic tip */}
      <circle cx="28" cy="63" r="2.5" fill="#43b581" />

      {/* Chat bubble (top right) */}
      <g transform="translate(66, 8)">
        <rect x="0" y="0" width="24" height="16" rx="8" fill="white" />
        <path d="M4 16 L0 22 L9 16" fill="white" />
        <circle cx="7.5" cy="8" r="1.8" fill="#808090" />
        <circle cx="12" cy="8" r="1.8" fill="#808090" />
        <circle cx="16.5" cy="8" r="1.8" fill="#808090" />
      </g>
    </svg>
  );
}
