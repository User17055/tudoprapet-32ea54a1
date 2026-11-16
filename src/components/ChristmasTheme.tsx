import { useLocation } from "react-router-dom";

// Tema de Natal: para remover, apague este arquivo, o bloco "Natal" do index.css e o uso de <ChristmasDecor />, e <ChristmasFooterDecor /> do Footer; e volte os imports de tpp-logo-natal.webp para tpp-logo.svg.

// [lado, distância da borda (px), duração (s), atraso (s), tamanho (px)]
const FLAKES: Array<["left" | "right", number, number, number, number]> = [
  ["left", 6, 11, 0, 22],
  ["left", 30, 15, 6, 16],
  ["left", 14, 13, 9, 29],
  ["left", 44, 17, 3, 19],
  ["left", 22, 12, 13, 14],
  ["right", 8, 12, 2, 24],
  ["right", 34, 16, 8, 16],
  ["right", 18, 14, 11, 27],
  ["right", 46, 18, 5, 18],
  ["right", 26, 13, 15, 14],
  ["left", 38, 14, 1, 18],
  ["left", 10, 16, 11, 14],
  ["left", 52, 12, 7, 21],
  ["left", 2, 18, 15, 16],
  ["left", 26, 11, 4, 26],
  ["right", 40, 15, 10, 19],
  ["right", 4, 17, 6, 16],
  ["right", 54, 11, 13, 22],
  ["right", 14, 13, 1, 14],
  ["right", 30, 19, 16, 21],
];

export const ChristmasDecor = () => {
  const { pathname } = useLocation();
  if (pathname.startsWith("/admin")) return null;
  return (
    <div aria-hidden="true">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] bg-[#D62839]" />
      {FLAKES.map(([side, edge, duration, delay, size], i) => (
        <span
          key={i}
          className="xmas-flake"
          // atraso negativo: os flocos já começam espalhados; os menores ficam mais transparentes, como se estivessem mais longe
          style={{ [side]: edge, fontSize: size, opacity: 0.4 + (size - 14) / 30, animationDuration: `${duration}s`, animationDelay: `-${delay}s` }}
        >
          {"❄︎"}
        </span>
      ))}
    </div>
  );
};

const SNOW_EDGE = "M0 11 Q40 11 65 13 Q90 15 115 11 Q140 7 170 10.5 Q200 14 225 11.5 Q250 9 285 10 Q320 11 360 11";
const SNOW_CREST = "#d5e1f1";
const RED = "#D62839";

// Rodapé de Natal: neve acumulada no pé do rodapé (tile sem emenda via <pattern>) e uma arvorezinha com presente.
export const ChristmasFooterDecor = () => (
  <div aria-hidden="true" className="pointer-events-none relative h-[92px]">
    <svg className="absolute inset-x-0 bottom-0 h-[30px] w-full">
      <defs>
        <pattern id="xmas-snow" width="360" height="30" patternUnits="userSpaceOnUse">
          <path fill="#fff" d={`${SNOW_EDGE} L360 30 L0 30Z`} />
          <path fill="none" stroke="#eef3fa" strokeWidth="4" transform="translate(0 3)" d={SNOW_EDGE} />
          <path fill="none" stroke={SNOW_CREST} strokeWidth="1.5" d={SNOW_EDGE} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#xmas-snow)" />
    </svg>

    {/* em px e em left 115px: as pontas do monte caem em x=115 e x=225 do tile da neve, onde a crista é conhecida, então emenda sem degrau */}
    <svg viewBox="0 0 110 92" className="absolute bottom-0 left-[115px] h-[92px] w-[110px] overflow-visible">
      <g transform="translate(0 -2) scale(0.9167)">
        <g transform="translate(18 0)">
          <rect x="26" y="66" width="8" height="14" rx="2" fill="#8a5a33" />
          <path d="M30 30 L56 68 Q30 75 4 68 Z" fill="#1b6e45" />
          <path d="M30 17 L49 49 Q30 55 11 49 Z" fill="#1f7f4f" />
          <path d="M30 5 L42 31 Q30 35 18 31 Z" fill="#24905a" />
          <path d="M4 68 Q10 63 16 67 Q22 64 30 68 Q38 64 44 67 Q50 63 56 68 Q30 75 4 68 Z" fill="#fff" />
          <path d="M11 49 Q17 45 23 48 Q30 45 37 48 Q43 45 49 49 Q30 55 11 49 Z" fill="#fff" />
          <path d="M18 31 Q24 28 30 31 Q36 28 42 31 Q30 35 18 31 Z" fill="#fff" />
          {[[16, 60], [43, 59], [30, 56], [22, 41], [38, 42], [30, 24]].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.3" fill={RED} />
          ))}
          <path d="M30 0 L32 4.5 L37 5 L33.2 8 L34.4 13 L30 10.4 L25.6 13 L26.8 8 L23 5 L28 4.5 Z" fill="#FED235" />
        </g>
        <rect x="80" y="62" width="20" height="18" rx="2" fill={RED} />
        <rect x="78" y="58" width="24" height="6" rx="1.5" fill="#e8475a" />
        <rect x="88.5" y="58" width="3" height="22" fill="#fff" />
        <ellipse cx="86" cy="55.5" rx="4" ry="2.4" fill="#fff" stroke={SNOW_CREST} strokeWidth=".6" />
        <ellipse cx="94" cy="55.5" rx="4" ry="2.4" fill="#fff" stroke={SNOW_CREST} strokeWidth=".6" />
      </g>
      {/* monte de neve cobrindo o pé da árvore e do presente */}
      <path fill="#fff" d="M0 73 C10 71.4 16 64 31 62.6 C44 61.4 50 60.6 57 61.5 C72 62.4 84 65 95 69.5 C100 71.6 104 74.1 110 73.5 L110 92 L0 92 Z" />
      <path fill="none" stroke="#eef3fa" strokeWidth="4" transform="translate(0 3)" d="M0 73 C10 71.4 16 64 31 62.6 C44 61.4 50 60.6 57 61.5 C72 62.4 84 65 95 69.5 C100 71.6 104 74.1 110 73.5" />
      <path fill="none" stroke={SNOW_CREST} strokeWidth="1.5" d="M0 73 C10 71.4 16 64 31 62.6 C44 61.4 50 60.6 57 61.5 C72 62.4 84 65 95 69.5 C100 71.6 104 74.1 110 73.5" />
    </svg>
  </div>
);
