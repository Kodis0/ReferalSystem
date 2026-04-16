import { useEffect, useRef } from "react";
import "./HeroDotsBackground.css";

const DOT_COUNT = 100;
const CORE_RADIUS_MIN = 1;
const CORE_RADIUS_MAX = 3;
const GLOW_BLUR = 55;
const COLLECT_CYCLE_MS = 24000;
const COLLECT_DURATION_MS = 5000;
const MOUSE_INFLUENCE = 0.022;
const DRIFT_SPEED = 0.0001;
const PULL_STRENGTH = 0.00005;

function createDots() {
  return Array.from({ length: DOT_COUNT }, (_, i) => {
    const angle = (i / DOT_COUNT) * Math.PI * 2 + Math.random() * 0.4;
    const radius = 0.15 + Math.random() * 0.65;
    return {
      angle,
      radius,
      angleSpeed: (Math.random() - 0.5) * 0.00015,
      radiusPhase: Math.random() * Math.PI * 2,
      radiusAmplitude: 0.03 + Math.random() * 0.04,
      radiusWaveSpeed: 0.00008 + Math.random() * 0.00005,
      size: CORE_RADIUS_MIN + Math.random() * (CORE_RADIUS_MAX - CORE_RADIUS_MIN),
      opacity: 0.55 + Math.random() * 0.4,
    };
  });
}

function HeroDotsBackground({ className = "", theme = "dark" }) {
  const canvasRef = useRef(null);
  const dotsRef = useRef(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const rafRef = useRef(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = canvas.parentElement;
    dotsRef.current = createDots();
    let width = 0;
    let height = 0;
    let time = 0;

    function setSize() {
      const w = container.offsetWidth;
      const h = container.offsetHeight;
      if (w === width && h === height) return;
      width = w;
      height = h;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    function getCollectPhase(now) {
      const cycle = COLLECT_CYCLE_MS;
      const duration = COLLECT_DURATION_MS;
      const t = (now % cycle) / cycle;
      const start = (cycle - duration) / cycle;
      if (t < start) return 0;
      const local = (t - start) / (duration / cycle);
      if (local <= 0.5) return local * 2;
      return 2 - local * 2;
    }

    function draw() {
      time += 16;
      const now = time * 0.001;
      const ctx = canvas.getContext("2d");
      if (!ctx || !width || !height) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const dpr = canvas.width / width;
      const isLight = themeRef.current === "light";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (isLight) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      const cx = width * 0.5;
      const cy = height * 0.5;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const parallaxX = (mx - 0.5) * width * MOUSE_INFLUENCE;
      const parallaxY = (my - 0.5) * height * MOUSE_INFLUENCE;
      const collectPhase = getCollectPhase(now * 1000);

      const dots = dotsRef.current;
      const aspect = width / height;
      const scale = Math.min(width, height) * 0.45;

      dots.forEach((d) => {
        d.angle += d.angleSpeed + DRIFT_SPEED;
        d.radiusPhase += d.radiusWaveSpeed;

        let r = d.radius + Math.sin(d.radiusPhase) * d.radiusAmplitude;
        if (collectPhase > 0) {
          r -= collectPhase * PULL_STRENGTH * 40;
          r = Math.max(0.12, r);
        }

        const nx = Math.cos(d.angle) * r * aspect;
        const ny = Math.sin(d.angle) * r;
        const x = cx + nx * scale + parallaxX;
        const y = cy + ny * scale + parallaxY;

        const px = x * dpr;
        const py = y * dpr;
        const glowR = GLOW_BLUR * dpr;
        const coreR = d.size * dpr;

        ctx.save();
        if (isLight) {
          ctx.shadowColor = `rgba(56, 40, 204, ${0.5 * d.opacity})`;
          ctx.shadowBlur = glowR * 1.4;
          ctx.fillStyle = `rgba(92, 67, 247, ${0.4 * d.opacity})`;
        } else {
          ctx.shadowColor = `rgba(190, 215, 255, ${0.45 * d.opacity})`;
          ctx.shadowBlur = glowR * 1.2;
          ctx.fillStyle = `rgba(220, 235, 255, ${0.35 * d.opacity})`;
        }
        ctx.beginPath();
        ctx.arc(px, py, coreR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      rafRef.current = requestAnimationFrame(draw);
    }

    const onResize = () => {
      setSize();
    };
    const onMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      mouseRef.current.x = (e.clientX - rect.left) / rect.width;
      mouseRef.current.y = (e.clientY - rect.top) / rect.height;
    };

    setSize();
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);
    container.addEventListener("mousemove", onMouseMove);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
      container.removeEventListener("mousemove", onMouseMove);
    };
  }, [theme]);

  return (
    <div className={`hero-dots-bg ${className}`} aria-hidden>
      <canvas ref={canvasRef} className="hero-dots-bg__canvas" />
    </div>
  );
}

export default HeroDotsBackground;
