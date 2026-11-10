type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const UndoIcon = (p: IconProps) => (
  <Svg size={14} strokeWidth={2.5} {...p}>
    <polyline points="9 14 4 9 9 4" />
    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  </Svg>
);

export const RedoIcon = (p: IconProps) => (
  <Svg size={14} strokeWidth={2.5} {...p}>
    <polyline points="15 14 20 9 15 4" />
    <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg fill="currentColor" stroke="none" {...p}>
    <polygon points="5 3 19 12 5 21 5 3" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg fill="currentColor" stroke="none" {...p}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </Svg>
);

export const CubeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </Svg>
);

export const StarIcon = (p: IconProps) => (
  <Svg strokeLinecap="butt" strokeLinejoin="miter" {...p}>
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </Svg>
);

export const SoundOnIcon = (p: IconProps) => (
  <Svg strokeLinecap="butt" strokeLinejoin="miter" {...p}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </Svg>
);

export const SoundOffIcon = (p: IconProps) => (
  <Svg strokeLinecap="butt" strokeLinejoin="miter" {...p}>
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </Svg>
);

export const CropIcon = (p: IconProps) => (
  <Svg strokeLinecap="butt" strokeLinejoin="miter" {...p}>
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  </Svg>
);

export const RotateIcon = (p: IconProps) => (
  <Svg size={20} {...p}>
    <path d="M23 4v6h-6" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </Svg>
);

export const SubtitleIcon = (p: IconProps) => (
  <Svg strokeLinecap="butt" strokeLinejoin="miter" {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M6 14h4M12 14h6M6 10h12" />
  </Svg>
);

export const VideoIcon = (p: IconProps) => (
  <Svg size={48} strokeWidth={1.5} strokeLinecap="butt" strokeLinejoin="miter" {...p}>
    <path d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
  </Svg>
);
