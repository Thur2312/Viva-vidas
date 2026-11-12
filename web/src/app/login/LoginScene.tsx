"use client";
// Cena de entrada: cinco camadas de vidro (as camadas de cobertura de um plano) com uma fita de ECG na frente.
// Geometria procedural (sem arquivo de modelo). Cores vêm dos tokens CSS, não de hex. Carregada só no login, sob demanda.
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

const N = 5;
const W = 3.4;
const D = 2.3;

/** Lê um token "R G B" do CSS e devolve uma cor do three. */
function token(name: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return new THREE.Color((v[0] ?? 0) / 255, (v[1] ?? 0) / 255, (v[2] ?? 0) / 255);
}

function ecgPoints(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const base = [[0, 0], [0.22, 0], [0.27, 0.05], [0.31, 0], [0.4, 0], [0.43, -0.12], [0.47, 0.62], [0.51, -0.38], [0.55, 0], [0.68, 0], [0.74, 0.14], [0.8, 0], [1, 0]];
  for (const [x, y] of base) pts.push(new THREE.Vector3(-W / 2 - 0.3 + x * (W + 0.6), y * 0.55, D / 2 + 0.25));
  return pts;
}

function Stack({ openRef }: { openRef: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const layers = useRef<(THREE.Group | null)[]>([]);
  const faces = useRef<THREE.MeshStandardMaterial[]>([]);
  const edges = useRef<THREE.LineBasicMaterial[]>([]);
  const ecg = useRef<THREE.Line>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const { box, edge, ecgGeo, menta, limao, sinal } = useMemo(() => {
    const b = new THREE.BoxGeometry(W, 0.05, D);
    return {
      box: b,
      edge: new THREE.EdgesGeometry(b),
      ecgGeo: new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(ecgPoints()).getPoints(120)),
      menta: token("--menta"), limao: token("--limao"), sinal: token("--sinal"),
    };
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.current.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      box.dispose(); edge.dispose(); ecgGeo.dispose();
    };
  }, [box, edge, ecgGeo]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const o = openRef.current; // 0 = fechado, 1 = aberto (animado pelo GSAP no palco)
    const spacing = 0.3 + o * 1.7;
    layers.current.forEach((g, i) => {
      if (!g) return;
      g.position.y = (i - (N - 1) / 2) * spacing + Math.sin(t * 0.9 + i * 0.7) * 0.02 * (1 - o);
      g.rotation.y = Math.sin(t * 0.3 + i * 0.4) * 0.04;
    });
    faces.current.forEach((m, i) => { if (m) m.opacity = (0.1 + i * 0.03) * (1 - o * 0.9); });
    edges.current.forEach((m) => { if (m) m.opacity = 0.95 * (1 - o); });
    if (group.current) {
      group.current.position.set(1.75, -0.5, 0);
      group.current.rotation.y = t * 0.12 + pointer.current.x * 0.35;
      group.current.rotation.x = 0.55 + pointer.current.y * 0.1;
      group.current.scale.setScalar(0.8 + o * 0.25);
    }
    if (ecg.current) {
      const total = ecgGeo.attributes.position.count;
      ecgGeo.setDrawRange(0, Math.floor(Math.min(1, ((t * 0.28) % 1.25)) * total));
    }
  });

  return (
    <group ref={group}>
      {Array.from({ length: N }, (_, i) => (
        <group key={i} ref={(g) => { layers.current[i] = g; }}>
          <mesh geometry={box}>
            <meshStandardMaterial ref={(m) => { if (m) faces.current[i] = m; }} color={menta} transparent opacity={0.2} roughness={0.25} metalness={0} depthWrite={false} />
          </mesh>
          <lineSegments geometry={edge}>
            <lineBasicMaterial ref={(m) => { if (m) edges.current[i] = m; }} color={i === N - 1 ? sinal : limao} transparent opacity={0.95} />
          </lineSegments>
        </group>
      ))}
      {/* @ts-expect-error: <line> do r3f colide com o <line> do SVG nos tipos JSX; é o THREE.Line */}
      <line ref={ecg} geometry={ecgGeo}>
        <lineBasicMaterial color={sinal} />
      </line>
    </group>
  );
}

export default function LoginScene({ openRef }: { openRef: MutableRefObject<number> }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 3.4, 9.2], fov: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0 }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />
      <Stack openRef={openRef} />
    </Canvas>
  );
}
