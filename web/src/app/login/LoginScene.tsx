"use client";
// Cena de entrada: o funil do CRM. Centenas de pontos (contatos) descem em vórtice por seis anéis (as etapas); a maioria
// vai sumindo pelo caminho e só alguns chegam ao fundo, em coral (as vendas). As taxas abaixo são ILUSTRATIVAS, não dados.
// Geometria e shader procedurais (sem arquivo de modelo). Cores vêm dos tokens CSS. Carregada só no login, sob demanda.
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

const N = 800; // contatos em cena
const RINGS = 6; // contato, resposta, qualificado, reunião, compareceu, venda
const H = 3.6; // altura do funil
const R_TOP = 1.9;
const R_BOT = 0.3;
// Fração que passa de uma etapa para a próxima (ilustrativa). Acumulada, vira P(t): a chance de um ponto ainda existir.
const KEEP = [1, 0.7, 0.5, 0.7, 0.8, 0.7];
const CUM = KEEP.reduce<number[]>((a, k) => [...a, (a.at(-1) ?? 1) * k], []);

const radius = (t: number) => R_BOT + (R_TOP - R_BOT) * Math.pow(1 - t, 1.6);
const alive = (t: number) => {
  const x = Math.min(RINGS - 1, Math.max(0, t * (RINGS - 1)));
  const i = Math.floor(x);
  const a = CUM[i];
  const b = CUM[Math.min(RINGS - 1, i + 1)];
  return a + (b - a) * (x - i);
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Lê um token "R G B" do CSS e devolve uma cor do three. */
function token(name: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return new THREE.Color((v[0] ?? 0) / 255, (v[1] ?? 0) / 255, (v[2] ?? 0) / 255);
}

const VERT = /* glsl */ `
  attribute float aAlpha; attribute float aSize; attribute vec3 aColor;
  varying float vA; varying vec3 vC;
  void main() {
    vA = aAlpha; vC = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  varying float vA; varying vec3 vC;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vA;
    gl_FragColor = vec4(vC * a, a);
  }`;

function Funnel({ openRef }: { openRef: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const d = useMemo(() => {
    const t = new Float32Array(N), theta = new Float32Array(N), jit = new Float32Array(N), s = new Float32Array(N), spd = new Float32Array(N);
    const respawn = (i: number, startAnywhere: boolean) => {
      t[i] = startAnywhere ? Math.random() : 0;
      theta[i] = Math.random() * Math.PI * 2;
      jit[i] = 0.72 + Math.random() * 0.28;
      s[i] = Math.random();
      spd[i] = 0.07 + Math.random() * 0.07;
    };
    for (let i = 0; i < N; i++) respawn(i, true);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(N), 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(N), 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

    // anéis das etapas e a silhueta do funil (linhas finas)
    const ringGeos = Array.from({ length: RINGS }, (_, k) => {
      const r = radius(k / (RINGS - 1));
      const pts = Array.from({ length: 72 }, (_, j) => new THREE.Vector3(Math.cos((j / 72) * Math.PI * 2) * r, H / 2 - (k / (RINGS - 1)) * H, Math.sin((j / 72) * Math.PI * 2) * r));
      return new THREE.BufferGeometry().setFromPoints(pts);
    });
    const hull: THREE.Vector3[] = [];
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      for (let j = 0; j < 40; j++) {
        for (const u of [j / 40, (j + 1) / 40]) hull.push(new THREE.Vector3(Math.cos(ang) * radius(u), H / 2 - u * H, Math.sin(ang) * radius(u)));
      }
    }
    const hullGeo = new THREE.BufferGeometry().setFromPoints(hull);
    return {
      t, theta, jit, s, spd, respawn, geo, mat, ringGeos, hullGeo,
      osso: token("--osso"), limao: token("--limao"), sinal: token("--sinal"),
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
      d.geo.dispose(); d.mat.dispose(); d.hullGeo.dispose(); d.ringGeos.forEach((g) => g.dispose());
    };
  }, [d]);

  const tmp = useMemo(() => new THREE.Color(), []);
  const ringMats = useRef<THREE.LineBasicMaterial[]>([]);
  const hullMat = useRef<THREE.LineBasicMaterial>(null);

  useFrame((_, dt0) => {
    const dt = Math.min(dt0, 0.05);
    const o = openRef.current; // 0 = fechado, 1 = aberto (o GSAP anima isso no palco)
    const pos = d.geo.attributes.position as THREE.BufferAttribute;
    const al = d.geo.attributes.aAlpha as THREE.BufferAttribute;
    const sz = d.geo.attributes.aSize as THREE.BufferAttribute;
    const co = d.geo.attributes.aColor as THREE.BufferAttribute;
    for (let i = 0; i < N; i++) {
      d.t[i] += d.spd[i] * dt * (1 + o * 9);
      if (d.t[i] >= 1) d.respawn(i, false);
      const t = d.t[i];
      d.theta[i] += (0.25 + 2.4 * t * t) * dt; // o vórtice acelera perto do fundo
      const r = radius(t) * d.jit[i] * (1 + o * 2.2);
      pos.setXYZ(i, Math.cos(d.theta[i]) * r, H / 2 - t * H, Math.sin(d.theta[i]) * r);
      const survive = smooth(0, 0.07, alive(t) - d.s[i]); // some quando a chance cai abaixo do seu sorteio
      al.setX(i, 0.7 * survive * smooth(0, 0.05, t) * (1 - o));
      sz.setX(i, 0.55 + t * 0.95); // pequenos: o brilho aditivo empilha e vira borrão se forem grandes
      // osso (contato) -> limão (em conversa) -> coral (chegou ao fim)
      if (t < 0.6) tmp.copy(d.osso).lerp(d.limao, t / 0.6);
      else tmp.copy(d.limao).lerp(d.sinal, smooth(0.6, 0.95, t));
      co.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    pos.needsUpdate = al.needsUpdate = sz.needsUpdate = co.needsUpdate = true;
    ringMats.current.forEach((m) => { if (m) m.opacity = 0.32 * (1 - o); });
    if (hullMat.current) hullMat.current.opacity = 0.1 * (1 - o);
    if (group.current) {
      group.current.position.set(1.3, -0.1, 0);
      group.current.rotation.y += dt * 0.12 + pointer.current.x * 0.004;
      group.current.rotation.x = 0.4 + pointer.current.y * 0.08;
      group.current.scale.setScalar(0.78 + o * 0.15);
    }
  });

  return (
    <group ref={group}>
      <points geometry={d.geo} material={d.mat} frustumCulled={false} />
      {d.ringGeos.map((g, k) => (
        <lineLoop key={k} geometry={g}>
          <lineBasicMaterial ref={(m) => { if (m) ringMats.current[k] = m; }} color={k === RINGS - 1 ? d.sinal : d.limao} transparent opacity={0.32} />
        </lineLoop>
      ))}
      <lineSegments geometry={d.hullGeo}>
        <lineBasicMaterial ref={hullMat} color={d.limao} transparent opacity={0.1} />
      </lineSegments>
    </group>
  );
}

export default function LoginScene({ openRef }: { openRef: MutableRefObject<number> }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 2.4, 9], fov: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0 }}
    >
      <Funnel openRef={openRef} />
    </Canvas>
  );
}
