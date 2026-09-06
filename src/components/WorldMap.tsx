import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAP_HEIGHT, MAP_WIDTH, shapes, groupOutline } from "@/lib/geo";


const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

type Props = {
  selected: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  correctId?: string | null;
  wrongId?: string | null;
  highlightIds?: string[];
  outlineIds?: string[];

  outlineLabel?: string;
  resetKey?: string | number;
};

export function WorldMap({
  selected,
  onSelect,
  disabled,
  correctId,
  wrongId,
  highlightIds,
  outlineIds,
  outlineLabel,

  resetKey,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const handleWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    downId: null as string | null,
  });


  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [resetKey]);

  const highlight = useMemo(() => new Set(highlightIds ?? []), [highlightIds]);
  const outline = useMemo(
    () => (outlineIds && outlineIds.length ? groupOutline(outlineIds) : null),
    [outlineIds],
  );


  const clientToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
    return point.matrixTransform(ctm.inverse());
  }, []);

  const zoomAt = useCallback((anchor: { x: number; y: number }, nextZoom: number) => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    setZoom((prev) => {
      const k = clamped / prev;
      setOffset((o) => ({
        x: anchor.x - (anchor.x - o.x) * k,
        y: anchor.y - (anchor.y - o.y) * k,
      }));
      return clamped;
    });
  }, []);

  useEffect(() => {
    handleWheelRef.current = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const next = zoom * Math.exp(-dy * 0.0015);
      if (next === zoom) return;
      zoomAt(clientToSvg(e.clientX, e.clientY), next);
    };
  }, [zoom, clientToSvg, zoomAt]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => handleWheelRef.current(e);
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const viewportCenter = useCallback((): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
    const rect = svg.getBoundingClientRect();
    return clientToSvg(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [clientToSvg]);

  const zoomIn = useCallback(() => zoomAt(viewportCenter(), zoom * 1.35), [zoomAt, viewportCenter, zoom]);
  const zoomOut = useCallback(() => zoomAt(viewportCenter(), zoom / 1.35), [zoomAt, viewportCenter, zoom]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const svg = e.currentTarget;
    svg.setPointerCapture(e.pointerId);
    const hit = (e.target as Element | null)?.getAttribute?.("data-id") ?? null;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
      downId: hit,
    };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.hypot(dx, dy) > 4) d.moved = true;
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return;
    setOffset({
      x: d.offsetX + dx / ctm.a,
      y: d.offsetY + dy / ctm.d,
    });
  };

  const finishPointer = (e: React.PointerEvent, allowSelect: boolean) => {
    const d = dragRef.current;
    const wasActive = d.active;
    d.active = false;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be released
    }
    if (!wasActive || !allowSelect || d.moved || disabled) {
      d.downId = null;
      return;
    }
    // Resolve the country under the pointer (capture retargets the event).
    let id = d.downId;
    if (!id) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      id = el?.getAttribute?.("data-id") ?? null;
    }
    d.downId = null;
    if (id) onSelect(id);
  };

  const transform = `translate(${offset.x.toFixed(2)} ${offset.y.toFixed(2)}) scale(${zoom.toFixed(4)})`;

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className={`block h-auto w-full select-none touch-none ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        role="img"
        aria-label="Mapa-múndi interativo"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finishPointer(e, true)}
        onPointerCancel={(e) => finishPointer(e, false)}
        onPointerLeave={(e) => finishPointer(e, false)}
      >
        <rect width={MAP_WIDTH} height={MAP_HEIGHT} className="fill-ocean" />
        {outline && (
          <g className="pointer-events-none" transform={transform}>
            <path d={outline.d} vectorEffect="non-scaling-stroke" className="hint-outline" />
          </g>
        )}
        <g transform={transform} strokeLinejoin="round" strokeLinecap="round">
          {shapes.map((s) => {
            const state =
              s.id === correctId
                ? "correct"
                : s.id === wrongId
                  ? "wrong"
                  : s.id === selected
                    ? "selected"
                    : highlight.has(s.id)
                      ? "hint"
                      : "idle";
            return (
              <path
                key={s.id}
                d={s.d}
                data-id={s.id}
                vectorEffect="non-scaling-stroke"
                data-state={state}
                className="country"
                style={{ cursor: disabled ? "default" : "pointer" }}
              />
            );
          })}
        </g>
        {outline && outlineLabel && (
          <g className="pointer-events-none" transform={transform}>
            <text
              x={outline.labelX}
              y={Math.max(14, outline.labelY - 10)}
              textAnchor="middle"
              className="hint-label"
            >
              {outlineLabel}
            </text>
          </g>
        )}

      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-xl border border-border bg-card/85 p-1 shadow-lg backdrop-blur-sm">
        <MapButton onClick={zoomIn} label="Aproximar" aria-label="Aproximar">
          +
        </MapButton>
        <MapButton onClick={zoomOut} label="Afastar" aria-label="Afastar">
          −
        </MapButton>
        <MapButton onClick={resetView} label="Redefinir" aria-label="Redefinir visualização">
          ⟲
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({
  onClick,
  label,
  children,
  "aria-label": ariaLabel,
}: {
  onClick: () => void;
  label?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-semibold text-foreground transition-colors hover:bg-accent/15 active:bg-accent/25"
    >
      {children}
    </button>
  );
}
