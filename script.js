const root = document.documentElement;
  let rAF=false, mx=innerWidth/2, my=innerHeight/2;
  const DPR_BASE = devicePixelRatio;
  let   RES_MULT = 2;
  const DPR = DPR_BASE * RES_MULT;

  addEventListener("mousemove", e=>{
    if (rAF) return; rAF=true;
    requestAnimationFrame(()=>{
      const w=innerWidth,h=innerHeight;
      mx=e.clientX; my=e.clientY;
      root.style.setProperty("--mouse-x", mx+"px");
      root.style.setProperty("--mouse-y", my+"px");
      root.style.setProperty("--mouse-xp",(mx/w).toString());
      root.style.setProperty("--mouse-yp",(my/h).toString());
      rAF=false;
    });
  }, {passive:true});

  const hero = document.querySelector(".hero");
  const wrapper = document.getElementById("wrapper");
  let cx = 0, cy = 0;
  let camX = 0, camY = 0; // virtual camera offset applied in draw()

  (function animate(){
    const tx = (mx/innerWidth) - 0.5;
    const ty = (my/innerHeight) - 0.5;
    cx += (tx - cx) * 0.04;
    cy += (ty - cy) * 0.04;

    const rotX = -cy * 4;
    const rotY = cx * 4;
    hero.style.transform =
      `translate3d(${Math.round(cx*8)}px, ${Math.round(cy*8)}px, 0) rotateX(${rotX}deg) rotateY(${rotY}deg)`;

    // virtual parallax for canvas (no DOM transform — avoids pointer distortion)
    camX = Math.round(cx * 6) * DPR;
    camY = Math.round(cy * 6) * DPR;

    requestAnimationFrame(animate);
  })();

  // Droplet renderer
  const fgCanvas = document.getElementById("drops");
  const ctx = fgCanvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  // Foreground stars layer (larger, brighter, fewer)
  const fgCanvas2 = document.getElementById("dropsFG");
  const ctxFG = fgCanvas2.getContext("2d");
  ctxFG.imageSmoothingEnabled = false;
let drops = [], W = 0, H = 0, t = 0, frame = 0;
let dropsFG = [];
let prevMx = mx, prevMy = my, mSpeed = 0;
const TWINKLE_RATE = 1;
let twGain = 50;
// --- Constellation state ---
let constellationTrailsBG = []; // background (hover) trails
let constellationTrailsFG = []; // foreground (drag) trails
const TRAIL_MAX_BG = 6;   // fewer links for hover trails
const TRAIL_MAX_FG = 10;  // slightly longer for drag trails
const FG_MIN_STEP = 8;    // minimum px distance between linked FG nodes (before DPR scaling)
const FG_LINK_MAX = 200;  // max visual link length / hover radius for FG trails (before DPR scaling)
let isDown = false;
const CONE_DEG = 22.5;
const CONE_COS = Math.cos(CONE_DEG * Math.PI/180);
let PICK_DIST = 500;
const SEG_FADE_MS = 1200;
let lastPickedId = -1;
let lastAddAt = 0;
let edgeSetBG = new Set();
let edgeSetFG = new Set();
let nearestStarId = -1;

function getNodeIndicatorRadius(star) {
  return Math.max(star.r * 2.6, 16 * DPR);
}

// Updated pointer event handling for constellation drawing
addEventListener('pointerdown', e => {
  isDown = true;
  const rect = fgCanvas2.getBoundingClientRect();
  const scaleX = (W || 1) / (rect.width || 1);
  const scaleY = (H || 1) / (rect.height || 1);
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  let startNode = null;
  let bestDist = Infinity;
  for (const d of dropsFG) {
    const dist = Math.hypot(d.x - px, d.y - py);
    if (dist < bestDist) {
      bestDist = dist;
      startNode = d;
    }
  }
  const indicatorRadius = startNode ? getNodeIndicatorRadius(startNode) : 0;
  const now = performance.now();
  if (startNode && bestDist <= indicatorRadius) {
    constellationTrailsFG.push([{ x: startNode.x, y: startNode.y, id: startNode.id, t: now }]);
    lastPickedId = startNode.id;
  } else {
    constellationTrailsFG.push([]);
    lastPickedId = -1;
  }
  lastAddAt = now;
  edgeSetFG.clear();
});
addEventListener('pointerup', () => {
  isDown = false;
  // leave trails intact so multiple trails persist
});

  // Fixed seed so both layers align identically
let SEED = Math.random() * 123456;
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}
  // Color-cycle sensitivity (higher = cycles more times for same mouse move)
  let COLOR_MULT = 18; // higher = more phase wraps per mouse move

  function resize() {
    W = fgCanvas.width = innerWidth * DPR;
    H = fgCanvas.height = innerHeight * DPR;
    fgCanvas.style.width = innerWidth + "px";
    fgCanvas.style.height = innerHeight + "px";
    // Foreground canvas (larger, brighter, fewer stars)
    fgCanvas2.width = innerWidth * DPR;
    fgCanvas2.height = innerHeight * DPR;
    fgCanvas2.style.width = innerWidth + "px";
    fgCanvas2.style.height = innerHeight + "px";

    // regenerate droplets proportional to area (seeded)
    const count = Math.round((innerWidth * innerHeight) / 2000);
    const rand = mulberry32(SEED ^ (W|0) ^ ((H|0)<<1));
    // --- Per-tile round-robin color balancing ---
    const tileCss = Math.max(90, Math.min(innerWidth, innerHeight) / 12);
    const tile = tileCss * DPR;
    const tileCounts = new Map();
    drops = Array.from({length:count}, (_, i) => {
      const base = 0.20 + Math.pow(rand(), 2.2) * 0.7;
      const extra = rand() < 0.02 ? (0.8 + rand()*0.8) : 0;
      let r = (base + extra) * DPR;
      if (rand() < 0.07) {
        const minBig = 0, maxBig = 0;
        r = Math.max(r, (minBig + rand() * (maxBig - minBig)) * DPR);
      }
      r = Math.min(r, 12 * DPR);
      r = Math.max(r, 1 * DPR);
      const c1 = 0.18 + rand()*0.36;
      const c2 = Math.min(0.95, c1 + 0.18 + rand()*0.32);
      const x = rand()*W;
      const y = rand()*H;
      const qx = Math.floor(x / tile), qy = Math.floor(y / tile);
      const key = qx + "," + qy;
      const used = tileCounts.get(key) || 0;
      const offset = ((qx*7) ^ (qy*11) ^ SEED) % 3;
      const kind = (used + offset) % 3;
      tileCounts.set(key, used + 1);
      const mono = true;
      const monoAlpha = 0.70 + rand()*0.25;
      const monoColor = kind === 0 ? [255,0,0] : (kind === 1 ? [0,255,0] : [0,0,255]);
      const p = rand();
      const phase = rand();
      const mix = 0.10 + rand()*0.30;
      const ax = rand()*2-1, ay = rand()*2-1;
      const al = Math.hypot(ax, ay) || 1;
      const dirx = ax/al, diry = ay/al;
      return {
        id: i,
        x,
        y,
        r,
        s: rand()*0.8 + 0.2,
        n: rand()*6.283,
        wob: 0.10 + rand()*0.35,
        gray: Math.round(60 + rand()*120),
        mA: monoAlpha,
        u: rand(), uT: rand(),
        dirx,
        diry,
        phase,
        mix,
        kind,
        tw: rand()*0.2,
        twT: rand(),
        twSpeed: (0.005 + rand()*0.02) * TWINKLE_RATE,
        twOmega: 2*Math.PI*(0.25 + rand()*1.0),
        twOmegaT: 2*Math.PI*(0.25 + rand()*1.0),
        twJit: 0.0005 + rand()*0.002,
        twP: rand()*6.283,
        mag: Math.pow(rand(), 3.0),
        mono: true,
        tint: (rand() < 0.5 ? -1 : 1) * (rand() * 0.1),
      };
    });
    // Foreground stars: fewer, larger, brighter
    const countFG = Math.round((innerWidth * innerHeight) / 24000);
    const randFG = mulberry32((SEED+1) ^ (W|0) ^ ((H|0)<<1));
    const newFG = [];
    const minSpacing = Math.max(W, H) * 0.05;
    for (let i = 0; i < countFG; i++) {
      let x = randFG()*W;
      let y = randFG()*H;
      if (countFG > 1) {
        let attempts = 0;
        while (attempts < 16) {
          let tooClose = false;
          for (const prev of newFG) {
            if (!prev) continue;
            const dist = Math.hypot(prev.x - x, prev.y - y);
            if (dist < minSpacing) {
              tooClose = true;
              break;
            }
          }
          if (!tooClose) break;
          x = randFG()*W;
          y = randFG()*H;
          attempts++;
        }
      }
      newFG.push({
        id: i,
        x,
        y,
        r: (1.8 + randFG()*2.8) * DPR,
        gray: 210 + randFG()*35,
        mA: 0.8,
        dirx: randFG()*2-1,
        diry: randFG()*2-1,
        tw: randFG()*0.2,
        twT: randFG(),
        twSpeed: (0.005 + randFG()*0.02) * TWINKLE_RATE,
        twOmega: 2*Math.PI*(0.25 + randFG()*1.0),
        twOmegaT: 2*Math.PI*(0.25 + randFG()*1.0),
        twJit: 0.0005 + randFG()*0.002,
        twP: randFG()*6.283,
        mag: 1,
        tint: (randFG()<0.5?-1:1)* (randFG()*0.12),
      });
    }
    dropsFG = newFG;
  }
  addEventListener("resize", resize);
  resize();

  // --- Helper: pick a star in the cursor's heading ---
  function pickConstellationStar(dirx, diry, mpx, mpy) {
    const maxDist = PICK_DIST * DPR; // convert to device px
    let best = null;
    let bestDist = Infinity;
    for (const d of drops) {
      const vx = d.x - mpx, vy = d.y - mpy;
      const dist = Math.hypot(vx, vy);
      if (dist < 1 || dist > maxDist) continue;
      const cosang = (vx*dirx + vy*diry) / dist;
      if (cosang < CONE_COS) continue;           // outside aim cone
      if (d.id === lastPickedId) continue;       // avoid immediate repeats
      if (dist < bestDist) { best = d; bestDist = dist; }
    }
    return best;
  }

  // --- Geometry: segment intersection (excludes shared endpoints) ---
  function segsIntersect(ax,ay,bx,by, cx,cy,dx,dy) {
    function orient(px,py,qx,qy, rx,ry){ return (qx-px)*(ry-py) - (qy-py)*(rx-px); }
    const o1 = orient(ax,ay,bx,by, cx,cy);
    const o2 = orient(ax,ay,bx,by, dx,dy);
    const o3 = orient(cx,cy,dx,dy, ax,ay);
    const o4 = orient(cx,cy,dx,dy, bx,by);
    if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) {
      // Treat colinear/touching as crossing; allow exact shared endpoints
      const eps = 1e-6;
      const isSharedEndpoint = (Math.hypot(ax-cx,ay-cy)<eps) || (Math.hypot(ax-dx,ay-dy)<eps) || (Math.hypot(bx-cx,by-cy)<eps) || (Math.hypot(bx-dx,by-dy)<eps);
      if (isSharedEndpoint) return false; // adjacent segments okay
      // Otherwise, consider as crossing to keep drawing clean
      return true;
    }
    const ab = (o1>0)!==(o2>0);
    const cd = (o3>0)!==(o4>0);
    return ab && cd;
  }

  function draw() {
    t += 0.016;
    // Update smoothed mouse speed
    const dmx = mx - prevMx, dmy = my - prevMy;
    const inst = Math.hypot(dmx, dmy);
    // Compute direction and pick constellation star BEFORE updating prevMx/prevMy
    const vlen = Math.hypot(dmx, dmy);
    let dirx = 0, diry = 0;
    if (vlen > 0.0001) { dirx = dmx / vlen; diry = dmy / vlen; }
    // Compute perspective-correct mouse relative to the transformed canvas
    const rect = fgCanvas.getBoundingClientRect();
    const scaleX = (W || 1) / (rect.width  || 1);
    const scaleY = (H || 1) / (rect.height || 1);
    const mpxEarly = (mx - rect.left) * scaleX;
    const mpyEarly = (my - rect.top)  * scaleY;
    let nearest = null, bestDist = Infinity;
    for (const d of drops) {
      const vx = (d.x + camX) - mpxEarly, vy = (d.y + camY) - mpyEarly;
      const dist = Math.hypot(vx, vy);
      if (dist < bestDist) { bestDist = dist; nearest = d; }
    }
    // For foreground stars, pick nearest as well (for click+drag trails)
    let nearestFG = null, bestDistFG = Infinity;
    for (const d of dropsFG) {
      const vx = (d.x + camX) - mpxEarly, vy = (d.y + camY) - mpyEarly;
      const dist = Math.hypot(vx, vy);
      if (dist < bestDistFG) { bestDistFG = dist; nearestFG = d; }
    }
    const now = performance.now();
    const fgMaxLinkDistPx = FG_LINK_MAX * DPR;
    const fgMinStepPx = FG_MIN_STEP * DPR;
    const fgPointerReachPx = fgMaxLinkDistPx;
    nearestStarId = nearest ? nearest.id : -1;
    mSpeed = mSpeed * 0.9 + inst * 0.1;
    prevMx = mx; prevMy = my;

    // --- Background trails (hover-based) ---
    // Always update BG trails on hover (not requiring isDown)
    if (vlen > 0.6) {
      // Pick nearest background star in cone
      const picked = (nearest && Math.hypot(nearest.x - mpxEarly, nearest.y - mpyEarly) <= PICK_DIST * DPR) ? nearest : null;
      let currentTrail = constellationTrailsBG[constellationTrailsBG.length-1];
      if (!currentTrail) {
        constellationTrailsBG.push([]);
        currentTrail = constellationTrailsBG[constellationTrailsBG.length-1];
      }
      if (picked && currentTrail) {
        const last = currentTrail[currentTrail.length - 1];
        const okDistance = !last || Math.hypot(picked.x - last.x, picked.y - last.y) > 8 * DPR;
        let okNotDup = true, okNoCross = true;
        if (last) {
          const key = (last.id < picked.id) ? `${last.id}-${picked.id}` : `${picked.id}-${last.id}`;
          if (edgeSetBG.has(key)) okNotDup = false;
          for (let i = 1; i < currentTrail.length; i++) {
            const a = currentTrail[i-1], b = currentTrail[i];
            if (b === last) continue;
            if (segsIntersect(a.x,a.y,b.x,b.y, last.x,last.y, picked.x,picked.y)) { okNoCross = false; break; }
          }
          if (okDistance && okNotDup && okNoCross) {
            currentTrail.push({ x: picked.x, y: picked.y, id: picked.id, t: now });
            edgeSetBG.add(key);
            // Eagerly drop fully expired head segments for this trail
            while (currentTrail.length > 1 && currentTrail[0]?._expireAt != null && currentTrail[0]._expireAt <= now) {
              const first = currentTrail[0], second = currentTrail[1];
              const kx = (first.id < second.id) ? `${first.id}-${second.id}` : `${second.id}-${first.id}`;
              edgeSetBG.delete(kx);
              currentTrail.shift();
            }
            while (currentTrail.length > TRAIL_MAX_BG) {
              const first = currentTrail[0], second = currentTrail[1];
              if (!first) break;
              if (first._expireAt == null) {
                first._expireAt = now + SEG_FADE_MS;
                break;
              }
              if (first._expireAt <= now || currentTrail.length > TRAIL_MAX_BG + 2) {
                if (second) {
                  const k2 = (first.id < second.id) ? `${first.id}-${second.id}` : `${second.id}-${first.id}`;
                  edgeSetBG.delete(k2);
                }
                currentTrail.shift();
              } else {
                break;
              }
            }
          }
          else {
            if (now - lastAddAt > 150) {
              constellationTrailsBG.push([{ x: picked.x, y: picked.y, id: picked.id, t: now }]);
            }
          }
        } else if (okDistance) {
          currentTrail.push({ x: picked.x, y: picked.y, id: picked.id, t: now });
        }
      }
    } else {
      // Per-trail: Slowly decay at rest
      for (let trailIdx = 0; trailIdx < constellationTrailsBG.length; trailIdx++) {
        let trail = constellationTrailsBG[trailIdx];
        while (trail.length > 1 && trail[0]?._expireAt != null && trail[0]._expireAt <= now) {
          const first = trail[0], second = trail[1];
          const kx = (first.id < second.id) ? `${first.id}-${second.id}` : `${second.id}-${first.id}`;
          edgeSetBG.delete(kx);
          trail.shift();
        }
        if (frame % 12 === 0 && trail.length > 1) {
          const a = trail[0], b = trail[1];
          if (a._expireAt == null) {
            a._expireAt = now + SEG_FADE_MS;
          } else if (now >= a._expireAt) {
            const k = (a.id < b.id) ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
            edgeSetBG.delete(k);
            trail.shift();
          }
        }
      }
      for (let i = constellationTrailsBG.length - 1; i >= 0; i--) {
        if (constellationTrailsBG[i].length === 0) {
          constellationTrailsBG.splice(i, 1);
        }
      }
    }

    // --- Foreground trails (click+drag) ---
    if (isDown) {
      // Choose the closest valid foreground candidate under the pointer
      let currentTrail = constellationTrailsFG[constellationTrailsFG.length-1];
      if (!currentTrail) {
        constellationTrailsFG.push([]);
        currentTrail = constellationTrailsFG[constellationTrailsFG.length-1];
      }
      const lastNode = currentTrail[currentTrail.length - 1];
      if (lastNode) {
        let bestCandidate = null;
        let bestPointerDist = Infinity;
        const debugRejects = [];
        for (const target of dropsFG) {
          if (target.id === lastNode.id) continue;
          const segDist = Math.hypot(target.x - lastNode.x, target.y - lastNode.y);
          if (segDist <= fgMinStepPx) {
            debugRejects.push({ id: target.id, reason: 'too-close', segDist });
            continue;
          }
          if (segDist > fgMaxLinkDistPx) {
            debugRejects.push({ id: target.id, reason: 'too-far', segDist });
            continue;
          }
          const indicatorRadius = getNodeIndicatorRadius(target);
          const screenDist = Math.hypot((target.x + camX) - mpxEarly, (target.y + camY) - mpyEarly);
          if (screenDist > indicatorRadius) {
            debugRejects.push({ id: target.id, reason: 'cursor-outside', screenDist, indicatorRadius });
            continue; // require cursor inside indicator
          }
          const key = (lastNode.id < target.id) ? `${lastNode.id}-${target.id}` : `${target.id}-${lastNode.id}`;
          if (edgeSetFG.has(key)) {
            debugRejects.push({ id: target.id, reason: 'duplicate-edge' });
            continue;
          }
          let crosses = false;
          for (let i = 1; i < currentTrail.length; i++) {
            const a = currentTrail[i - 1];
            const b = currentTrail[i];
            if (b.id === lastNode.id || a.id === lastNode.id) continue;
            if (segsIntersect(a.x, a.y, b.x, b.y, lastNode.x, lastNode.y, target.x, target.y)) {
              crosses = true;
              break;
            }
          }
          if (crosses) {
            debugRejects.push({ id: target.id, reason: 'crosses-existing' });
            continue;
          }
          if (screenDist < bestPointerDist) {
            bestPointerDist = screenDist;
            bestCandidate = target;
          }
        }
        if (bestCandidate) {
          const key = (lastNode.id < bestCandidate.id) ? `${lastNode.id}-${bestCandidate.id}` : `${bestCandidate.id}-${lastNode.id}`;
          const segDist = Math.hypot(bestCandidate.x - lastNode.x, bestCandidate.y - lastNode.y);
          console.debug('[FG link:accept]', {
            from: lastNode.id,
            to: bestCandidate.id,
            segDist,
            minDist: fgMinStepPx,
            maxDist: fgMaxLinkDistPx,
            cursorDist: bestPointerDist
          });
          const nowFade = performance.now();
          for (const trailRef of constellationTrailsFG) {
            if (!trailRef || trailRef.length < 2) continue;
            if (trailRef === currentTrail) continue;
            for (let i = 0; i < trailRef.length - 1; i++) {
              const seg = trailRef[i];
              if (!seg) continue;
              const targetExpire = nowFade + SEG_FADE_MS;
              seg._expireAt = seg._expireAt != null ? Math.min(seg._expireAt, targetExpire) : targetExpire;
            }
          }
          currentTrail.push({ x: bestCandidate.x, y: bestCandidate.y, id: bestCandidate.id, t: now });
          edgeSetFG.add(key);
          lastPickedId = bestCandidate.id;
          lastAddAt = now;
        } else {
          console.debug('[FG link:none]', {
            lastId: lastNode.id,
            minDist: fgMinStepPx,
            maxDist: fgMaxLinkDistPx,
            candidatesChecked: dropsFG.length,
            rejects: debugRejects.slice(0, 10)
          });
        }
      }
    } else {
      for (let trailIdx = 0; trailIdx < constellationTrailsFG.length; trailIdx++) {
        let trail = constellationTrailsFG[trailIdx];
        while (trail.length > 1 && trail[0]?._expireAt != null && trail[0]._expireAt <= now) {
          const first = trail[0], second = trail[1];
          const kx = (first.id < second.id) ? `${first.id}-${second.id}` : `${second.id}-${first.id}`;
          edgeSetFG.delete(kx);
          trail.shift();
        }
        if (frame % 12 === 0 && trail.length > 1) {
          const a = trail[0], b = trail[1];
          if (a._expireAt == null) {
            a._expireAt = now + SEG_FADE_MS;
          } else if (now >= a._expireAt) {
            const k = (a.id < b.id) ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
            edgeSetFG.delete(k);
            trail.shift();
          }
        }
      }
      for (let i = constellationTrailsFG.length - 1; i >= 0; i--) {
        if (constellationTrailsFG[i].length === 0) {
          constellationTrailsFG.splice(i, 1);
        }
      }
    }

    // Highlight state: active FG node + candidate connections
    const fgHighlightCandidateIds = new Set();
    const fgPreviewLines = [];
    let fgActiveNodeId = -1;
    let fgActiveTrail = null;
    let fgActiveSource = null;
    if (isDown) {
      fgActiveTrail = constellationTrailsFG[constellationTrailsFG.length - 1] || null;
      const lastNode = fgActiveTrail && fgActiveTrail[fgActiveTrail.length - 1];
      if (lastNode) {
        fgActiveSource = dropsFG.find(d => d.id === lastNode.id) || null;
      }
    } else if (nearestFG && bestDistFG <= fgPointerReachPx) {
      fgActiveSource = nearestFG;
      fgActiveTrail = null;
    }

    if (fgActiveSource) {
      fgActiveNodeId = fgActiveSource.id;
      if (!fgActiveTrail || fgActiveTrail[fgActiveTrail.length - 1]?.id !== fgActiveSource.id) {
        fgActiveTrail = null;
      }
      if (isDown) {
        for (const target of dropsFG) {
          if (target.id === fgActiveSource.id) continue;
          const key = fgActiveSource.id < target.id ? `${fgActiveSource.id}-${target.id}` : `${target.id}-${fgActiveSource.id}`;
          if (edgeSetFG.has(key)) continue;
          const dist = Math.hypot(target.x - fgActiveSource.x, target.y - fgActiveSource.y);
          if (dist < fgMinStepPx || dist > fgMaxLinkDistPx) continue;
          let intersects = false;
          if (fgActiveTrail && fgActiveTrail.length > 1) {
            for (let i = 1; i < fgActiveTrail.length; i++) {
              const a = fgActiveTrail[i-1];
              const b = fgActiveTrail[i];
              if (a.id === fgActiveSource.id || b.id === fgActiveSource.id) continue;
              if (segsIntersect(a.x, a.y, b.x, b.y, fgActiveSource.x, fgActiveSource.y, target.x, target.y)) {
                intersects = true;
                break;
              }
            }
          }
          if (!intersects) {
            fgHighlightCandidateIds.add(target.id);
            fgPreviewLines.push({ from: fgActiveSource, to: target });
          }
        }
      }
    }

    // Global motion → twinkle intensity mapping (rest = low, moving = high)
    const speedAmtGlobal = Math.min(1, mSpeed / (40 * DPR)); // requires more velocity for full effect
    const targetTw = 0.70 + 3.50 * speedAmtGlobal; // 0.70x at rest → 4.2x at full speed
    twGain += (targetTw - twGain) * 0.06; // ease for natural ramp

    // Device-pixel mouse coords (used for rendering below)
    const mpx = mpxEarly, mpy = mpyEarly;

    // --- Draw background stars ---
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(camX, camY);
    for (const d of drops) {
      // --- Twinkle update ---
      d.tw += (d.twT - d.tw) * (d.twSpeed * 0.5);
      if (Math.abs(d.tw - d.twT) < 0.02 && Math.random() < 0.25) {
        d.twT = Math.random();
        d.twSpeed = (0.005 + Math.random()*0.02) * TWINKLE_RATE;
      }
      d.twOmega += (d.twOmegaT - d.twOmega) * (d.twJit * 0.5);
      if (Math.random() < 0.005) {
        d.twOmegaT = 2*Math.PI*(0.25 + Math.random()*1.0);
      }
      const basePulse = (Math.max(0, Math.sin(d.twP + (t * TWINKLE_RATE) * d.twOmega)) ** 2) * d.tw * (0.7 + 1.5*d.mag);
      const speedAmt = Math.min(1, mSpeed / (12 * DPR));
      const micro = Math.max(0, Math.sin(d.twP * 1.7 + (t * TWINKLE_RATE) * (1.2 + 2.5 * d.u))) * (0.30 + 0.70 * speedAmt);
      const sPulse = basePulse * twGain + micro * (0.5 + 0.8 * Math.min(1, mSpeed / (40 * DPR)));
      const nx = mx/innerWidth, ny = my/innerHeight;
      const wx = Math.sign(nx - 0.5) * Math.pow(Math.abs(nx - 0.5), 0.75) + 0.5;
      const wy = Math.sign(ny - 0.5) * Math.pow(Math.abs(ny - 0.5), 0.75) + 0.5;
      const speedAmtG = Math.min(1, mSpeed / (10 * DPR));
      const globalPhase = (((((wx + wy) * 0.5) * COLOR_MULT + speedAmtG * 0.35) % 1) + 1) % 1;
      const dx = mpxEarly - (d.x + camX), dy = mpyEarly - (d.y + camY);
      const proj = (dx * d.dirx + dy * d.diry) / (80 * DPR);
      const localPhase = (((d.phase + proj) % 1) + 1) % 1;
      const phaseBlend = d.mix * globalPhase + (1 - d.mix) * localPhase;
      const phaseBlendFast = (((phaseBlend + 0.18 * speedAmtG) % 1) + 1) % 1;
      const jitter = Math.sin((t * TWINKLE_RATE) * (0.6 + d.u * 2.2) + d.u * 12.7) * (0.20 + 0.70 * speedAmt);
      const phaseJ = Math.max(0, Math.min(1, phaseBlendFast + jitter));
      const minG = 70 - 40 * Math.min(1, mSpeed / (40 * DPR));
      const maxG = 160 + 120 * Math.min(1, mSpeed / (40 * DPR));
      const targetGray = Math.round(minG + phaseJ * (maxG - minG));
      const dist = Math.hypot(dx, dy);
      const baseGain = 0.06;
      const nearBoost = 0.18;
      const scale = 120 * DPR;
      const gain = baseGain + nearBoost * (1 - Math.tanh(dist / scale));
      d.gray += (targetGray - d.gray) * Math.min(1, gain * 0.5);
      const G = Math.max(0, Math.min(255, Math.round(d.gray)));
      const A = Math.min(1, (d.mA || 0.9) * 0.6 + 0.25);
      const sizeBoost = Math.min(1.45, Math.max(0.65, (1.8 * DPR) / (d.r + 0.5)));
      const baseRestScale = 0.60 + 0.40 * Math.min(1, mSpeed / (40 * DPR));
      const baseGrayAdj = Math.round(G * (0.75 + 0.60 * d.mag) * sizeBoost * baseRestScale);
      const baseAlphaAdj = Math.min(1, A * (0.80 + 0.70 * d.mag) * baseRestScale);
      const brightGain = 1.0 + 1.2 * Math.min(1, mSpeed / (40 * DPR));
      const GG = Math.min(255, baseGrayAdj + Math.round((4 + 12 * d.mag) * sizeBoost * sPulse * brightGain));
      const AA = Math.min(1, baseAlphaAdj + (0.05 + 0.12 * d.mag) * sPulse * brightGain);
      const rTint = Math.min(255, Math.max(200, GG + (d.tint || 0) * 160));
      const bTint = Math.min(240, Math.max(180, GG - (d.tint || 0) * 200));
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(${rTint},${GG},${bTint},${AA})`;
      if (d.r <= 1.5 * DPR) {
        ctx.fillRect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
      } else {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Draw BG trails (hover-based)
  const kWidth = parseFloat(document.getElementById('kWidth')?.value || '1.4');
  const kAlpha = parseFloat(document.getElementById('kAlpha')?.value || '0.35');
  const kHue   = parseFloat(document.getElementById('kHue')?.value || '210');
  const kDash  = parseFloat(document.getElementById('kDash')?.value || '0');
    // Background constellation trails hidden per latest design request.
    ctx.restore();

    // --- Draw foreground stars and trails ---
    ctxFG.clearRect(0, 0, W, H);
    ctxFG.save();
    ctxFG.setTransform(1, 0, 0, 1, 0, 0);
    ctxFG.translate(camX, camY);
    for (const d of dropsFG) {
      // Twinkle update
      d.tw += (d.twT - d.tw) * (d.twSpeed * 0.5);
      if (Math.abs(d.tw - d.twT) < 0.02 && Math.random() < 0.22) {
        d.twT = Math.random();
        d.twSpeed = (0.005 + Math.random()*0.02) * TWINKLE_RATE;
      }
      d.twOmega += (d.twOmegaT - d.twOmega) * (d.twJit * 0.5);
      if (Math.random() < 0.005) {
        d.twOmegaT = 2*Math.PI*(0.25 + Math.random()*1.0);
      }
      const basePulse = (Math.max(0, Math.sin(d.twP + (t * TWINKLE_RATE) * d.twOmega)) ** 2) * d.tw * (1.2 + 1.3*d.mag);
      // Brighter, more static
      const baseLum = Math.min(255, 215 + basePulse * 30 + d.mag * 18);
      const redCh = Math.min(255, baseLum + 12);
      const greenCh = Math.min(255, baseLum + 4);
      const blueCh = Math.max(175, baseLum - 35);
      const AA = Math.min(1, 0.55 + basePulse * 0.25 + d.mag * 0.2);
      const isCandidate = fgHighlightCandidateIds.has(d.id);
      const isActive = d.id === fgActiveNodeId;
      if (isCandidate || isActive) {
        ctxFG.save();
        ctxFG.globalCompositeOperation = "lighter";
        const indicatorRadius = getNodeIndicatorRadius(d);
        if (isCandidate) {
          ctxFG.strokeStyle = `hsla(${kHue}, 60%, 82%, 0.45)`;
          ctxFG.lineWidth = Math.max(1.2 * DPR, indicatorRadius * 0.18);
          ctxFG.beginPath();
          ctxFG.arc(d.x, d.y, indicatorRadius, 0, Math.PI * 2);
          ctxFG.stroke();
        }
        if (isActive) {
          ctxFG.strokeStyle = `hsla(${kHue}, 70%, 92%, 0.9)`;
          ctxFG.lineWidth = Math.max(1.6 * DPR, indicatorRadius * 0.26);
          ctxFG.beginPath();
          ctxFG.arc(d.x, d.y, indicatorRadius * 1.15, 0, Math.PI * 2);
          ctxFG.stroke();
        }
        ctxFG.restore();
      }
      ctxFG.globalCompositeOperation = "lighter";
      ctxFG.fillStyle = `rgba(${redCh},${greenCh},${blueCh},${AA})`;
      ctxFG.beginPath();
      ctxFG.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctxFG.fill();
    }
    // Draw FG trails (click+drag)
    for (const trail of constellationTrailsFG) {
      if (trail.length > 1) {
        ctxFG.save();
        ctxFG.globalCompositeOperation = "lighter";
        ctxFG.lineJoin = "round";
        ctxFG.lineCap = "round";
        const L = trail.length;
        for (let i = 1; i < L; i++) {
          const a = trail[i-1];
          const b = trail[i];
          const segDist = Math.hypot(b.x - a.x, b.y - a.y);
          if (segDist > fgMaxLinkDistPx) continue;
          let fadeMul = 1;
          if (a && a._expireAt != null) {
            fadeMul = Math.max(0, Math.min(1, (a._expireAt - now) / SEG_FADE_MS));
          }
          if (a && a._expireAt != null && a._expireAt <= now) continue;
          // Brighter, thicker, higher alpha
          const alpha = Math.min(1, 0.7 * fadeMul); // brighter
          if (alpha <= 0.001) continue;
          ctxFG.strokeStyle = `hsla(${kHue}, 55%, 90%, ${alpha})`;
          ctxFG.lineWidth = Math.max(1.5, kWidth * 2.5) * DPR;
          if (kDash > 0) ctxFG.setLineDash([kDash * DPR, kDash * DPR]); else ctxFG.setLineDash([]);
          ctxFG.beginPath();
          ctxFG.moveTo(a.x, a.y);
          ctxFG.lineTo(b.x, b.y);
          ctxFG.stroke();
        }
        ctxFG.setLineDash([]);
        ctxFG.restore();
      }
    }
    ctxFG.restore();

    // Draw candidate preview lines for active FG node
    if (fgActiveNodeId !== -1 && fgPreviewLines.length) {
      const kHue = parseFloat(document.getElementById('kHue')?.value || '210');
      ctxFG.save();
      ctxFG.globalCompositeOperation = "lighter";
      ctxFG.lineWidth = Math.max(1.0, kWidth * 0.7) * DPR;
      ctxFG.strokeStyle = `hsla(${kHue}, 60%, 88%, 0.3)`;
      ctxFG.setLineDash([6 * DPR, 6 * DPR]);
      for (const { from, to } of fgPreviewLines) {
        ctxFG.beginPath();
        ctxFG.moveTo(from.x, from.y);
        ctxFG.lineTo(to.x, to.y);
        ctxFG.stroke();
      }
      ctxFG.restore();
    }

    // // --- DEBUG: mouse tracker dot ---
    // (function(){
    //   ctx.save();
    //   ctx.globalCompositeOperation = "source-over";
    //   ctx.beginPath();
    //   ctx.arc(mpx, mpy, 3 * DPR, 0, Math.PI*2);
    //   ctx.fillStyle = "rgba(255,255,255,0.95)";
    //   ctx.fill();
    //   ctx.lineWidth = 1 * DPR;
    //   ctx.strokeStyle = "rgba(0,0,0,0.85)";
    //   ctx.stroke();
    //   ctx.restore();
    // })();
    frame++;
    requestAnimationFrame(draw);
  }
  draw();
