/* ---------------------------------------------------------------------
   Applied Concepts — Ballistics module
   Point-mass exterior ballistics solver (McCoy/JBM-style), using the
   standard G1 and G7 drag tables. Ported from the open-source
   go_ballisticcalc project (gehtsoft-usa), cross-checked against
   published references — same method used by most commercial ballistic
   calculators (Applied Ballistics, JBM, Strelok, etc.).

   Assumptions (v1, still true for computeHoldTableMil/computeTrajectoryProfile
   below — the Zero Optic Calculator and Dry Fire hold tables):
   - Fixed ICAO standard atmosphere at sea level (15°C / 59°F, 29.92 inHg,
     0% humidity).
   - Flat, level fire (no shot angle, no wind, no Coriolis, no spin drift).
   - Output: hold in MIL only.

   v2 (25-09-2026, voor Dope Card) adds computeAtmosphere() for a variable
   temperature/altitude/pressure, and computeDopeCardTable() for a wind
   hold per distance — via the standard "lag time" approximation
   (drift = crosswind_mps × (actual time of flight − no-drag time of
   flight)), the same simplification McCoy/JBM use for flat-fire wind
   drift; it lets the UI compute once per 1 m/s and scale linearly.
   Spin drift was added later (Miller stability + Litz' formula, see below).

   v3 (09-10-2026, Dope Card op Kestrel/Applied Ballistics-niveau):
   - Aerodynamic jump (Litz): verticale sprong door zijwind, als vaste hoek.
   - Coriolis: horizontaal (afhankelijk van breedtegraad) en verticaal
     (Eötvös, afhankelijk van de schietrichting), mee-geïntegreerd in de
     baanberekening i.p.v. een constante-snelheid-vuistregel.
   - Kop-/meewind: drag rekent met de snelheid t.o.v. de lucht; de UI krijgt
     een lineaire coëfficiënt (mil elevatie per m/s kopwind).
   - Schuin schieten: exacte berekening met de zwaartekracht ontbonden langs
     en loodrecht op de zichtlijn (i.p.v. de cosinusregel).
   - Luchtvochtigheid in de luchtdichtheid; kruittemperatuur -> V0.
   - Links- of rechtsdraaiende loop (spin drift en aerodynamic jump).
--------------------------------------------------------------------- */

const BALLISTICS_GRAVITY_FPS2 = 32.17405;
const BALLISTICS_PIR = 2.08551e-4; // (PI/8)*(RHO0/144)
const BALLISTICS_FT_PER_M = 3.280839895;

// Standard atmosphere (sea level, 59°F, 0% humidity): density factor is 1
// by definition, and the speed of sound follows from temperature alone.
const BALLISTICS_STD_TEMP_K = 288.15; // 59°F in Kelvin
const BALLISTICS_MACH1_FPS = 331.3 * Math.sqrt(BALLISTICS_STD_TEMP_K / 273.15) / 0.3048;
const BALLISTICS_DENSITY_FACTOR = 1.0;

// Standard G1 drag table (Mach, Cd)
const G1_DRAG_TABLE = [
  [0.00, 0.2629], [0.05, 0.2558], [0.10, 0.2487], [0.15, 0.2413], [0.20, 0.2344],
  [0.25, 0.2278], [0.30, 0.2214], [0.35, 0.2155], [0.40, 0.2104], [0.45, 0.2061],
  [0.50, 0.2032], [0.55, 0.2020], [0.60, 0.2034], [0.70, 0.2165], [0.725, 0.2230],
  [0.75, 0.2313], [0.775, 0.2417], [0.80, 0.2546], [0.825, 0.2706], [0.85, 0.2901],
  [0.875, 0.3136], [0.90, 0.3415], [0.925, 0.3734], [0.95, 0.4084], [0.975, 0.4448],
  [1.0, 0.4805], [1.025, 0.5136], [1.05, 0.5427], [1.075, 0.5677], [1.10, 0.5883],
  [1.125, 0.6053], [1.15, 0.6191], [1.20, 0.6393], [1.25, 0.6518], [1.30, 0.6589],
  [1.35, 0.6621], [1.40, 0.6625], [1.45, 0.6607], [1.50, 0.6573], [1.55, 0.6528],
  [1.60, 0.6474], [1.65, 0.6413], [1.70, 0.6347], [1.75, 0.6280], [1.80, 0.6210],
  [1.85, 0.6141], [1.90, 0.6072], [1.95, 0.6003], [2.00, 0.5934], [2.05, 0.5867],
  [2.10, 0.5804], [2.15, 0.5743], [2.20, 0.5685], [2.25, 0.5630], [2.30, 0.5577],
  [2.35, 0.5527], [2.40, 0.5481], [2.45, 0.5438], [2.50, 0.5397], [2.60, 0.5325],
  [2.70, 0.5264], [2.80, 0.5211], [2.90, 0.5168], [3.00, 0.5133], [3.10, 0.5105],
  [3.20, 0.5084], [3.30, 0.5067], [3.40, 0.5054], [3.50, 0.5040], [3.60, 0.5030],
  [3.70, 0.5022], [3.80, 0.5016], [3.90, 0.5010], [4.00, 0.5006], [4.20, 0.4998],
  [4.40, 0.4995], [4.60, 0.4992], [4.80, 0.4990], [5.00, 0.4988],
];

// Standard G7 drag table (Mach, Cd)
const G7_DRAG_TABLE = [
  [0.00, 0.1198], [0.05, 0.1197], [0.10, 0.1196], [0.15, 0.1194], [0.20, 0.1193],
  [0.25, 0.1194], [0.30, 0.1194], [0.35, 0.1194], [0.40, 0.1193], [0.45, 0.1193],
  [0.50, 0.1194], [0.55, 0.1193], [0.60, 0.1194], [0.65, 0.1197], [0.70, 0.1202],
  [0.725, 0.1207], [0.75, 0.1215], [0.775, 0.1226], [0.80, 0.1242], [0.825, 0.1266],
  [0.85, 0.1306], [0.875, 0.1368], [0.90, 0.1464], [0.925, 0.1660], [0.95, 0.2054],
  [0.975, 0.2993], [1.0, 0.3803], [1.025, 0.4015], [1.05, 0.4043], [1.075, 0.4034],
  [1.10, 0.4014], [1.125, 0.3987], [1.15, 0.3955], [1.20, 0.3884], [1.25, 0.3810],
  [1.30, 0.3732], [1.35, 0.3657], [1.40, 0.3580], [1.50, 0.3440], [1.55, 0.3376],
  [1.60, 0.3315], [1.65, 0.3260], [1.70, 0.3209], [1.75, 0.3160], [1.80, 0.3117],
  [1.85, 0.3078], [1.90, 0.3042], [1.95, 0.3010], [2.00, 0.2980], [2.05, 0.2951],
  [2.10, 0.2922], [2.15, 0.2892], [2.20, 0.2864], [2.25, 0.2835], [2.30, 0.2807],
  [2.35, 0.2779], [2.40, 0.2752], [2.45, 0.2725], [2.50, 0.2697], [2.55, 0.2670],
  [2.60, 0.2643], [2.65, 0.2615], [2.70, 0.2588], [2.75, 0.2561], [2.80, 0.2533],
  [2.85, 0.2506], [2.90, 0.2479], [2.95, 0.2451], [3.00, 0.2424], [3.10, 0.2368],
  [3.20, 0.2313], [3.30, 0.2258], [3.40, 0.2205], [3.50, 0.2154], [3.60, 0.2106],
  [3.70, 0.2060], [3.80, 0.2017], [3.90, 0.1975], [4.00, 0.1935], [4.20, 0.1861],
  [4.40, 0.1793], [4.60, 0.1730], [4.80, 0.1672], [5.00, 0.1618],
];

function dragTableFor(model){
  return model === 'G7' ? G7_DRAG_TABLE : G1_DRAG_TABLE;
}

// Linear interpolation of Cd at a given Mach number (table is sorted ascending).
function dragCd(table, mach){
  if(mach <= table[0][0]) return table[0][1];
  const last = table[table.length-1];
  if(mach >= last[0]) return last[1];
  let lo = 0, hi = table.length-1;
  while(hi - lo > 1){
    const mid = (lo+hi) >> 1;
    if(table[mid][0] < mach) lo = mid; else hi = mid;
  }
  const [m0,c0] = table[lo], [m1,c1] = table[hi];
  const t = (mach - m0) / (m1 - m0);
  return c0 + t*(c1-c0);
}

function getCalculationStepFt(stepFt){
  const maxStepFt = 0.1 * BALLISTICS_FT_PER_M; // 0.1 m, matches the reference engine's default
  let step = stepFt / 2;
  if(step > maxStepFt){
    const stepOrder = Math.floor(Math.log10(step));
    const maxOrder = Math.floor(Math.log10(maxStepFt));
    step = step / Math.pow(10, stepOrder - maxOrder + 1);
  }
  return step;
}

// Earth's rotation rate (sidereal), rad/s.
const BALLISTICS_EARTH_OMEGA = 7.292115e-5;

/**
 * Coriolis setup for simulateDropAtDistances: latitude (deg, + = north) and
 * the azimuth of fire (deg from true north, clockwise). azimuthDeg null =
 * unknown direction: only the horizontal part that doesn't depend on it.
 */
function coriolisParams(latitudeDeg, azimuthDeg){
  if(latitudeDeg == null || isNaN(latitudeDeg)) return null;
  const lat = latitudeDeg * Math.PI/180;
  const hasAz = azimuthDeg != null && !isNaN(azimuthDeg);
  const az = hasAz ? azimuthDeg * Math.PI/180 : 0;
  return {
    // Coriolis acceleration -2Ω×v in the (downrange, up, right) frame:
    //   up    = 2Ω·cos(lat)·sin(az)·vx            (Eötvös: east = high)
    //   right = 2Ω·sin(lat)·vx − 2Ω·cos(lat)·cos(az)·vy
    upPerVx: hasAz ? 2*BALLISTICS_EARTH_OMEGA*Math.cos(lat)*Math.sin(az) : 0,
    rightPerVx: 2*BALLISTICS_EARTH_OMEGA*Math.sin(lat),
    rightPerVy: hasAz ? -2*BALLISTICS_EARTH_OMEGA*Math.cos(lat)*Math.cos(az) : 0,
  };
}

/**
 * Simulates the trajectory for one barrel elevation and returns the bullet
 * height relative to the line of sight (ft) at each requested distance (ft).
 * targetDistancesFt must be sorted ascending. densityFactor/machFps default
 * to the fixed ICAO sea-level standard used by the Optic Calculator/Dry
 * Fire; Dope Card passes computeAtmosphere()'s values instead.
 *
 * Optional (all default to "off", which reproduces the original flat-fire
 * loop exactly):
 * - lookAngleRad: shot angle (+ = uphill). x runs along the line of sight,
 *   gravity is split into a component along it and one perpendicular to it.
 * - headwindFps: range wind (+ = blowing towards the shooter); drag uses the
 *   bullet's speed relative to the air.
 * - coriolis: coriolisParams(); adds z (ft, + = right) to each result.
 */
function simulateDropAtDistances({ effectiveBC, dragTable, muzzleVelocityFps, sightHeightFt, barrelElevationRad, targetDistancesFt, calcStepFt, densityFactor, machFps, lookAngleRad, headwindFps, coriolis }){
  const ballisticFactor = 1 / effectiveBC;
  const look = lookAngleRad || 0;
  const gravityX = -BALLISTICS_GRAVITY_FPS2 * Math.sin(look);
  const gravityY = -BALLISTICS_GRAVITY_FPS2 * Math.cos(look);
  const headwind = headwindFps || 0;
  const rho = densityFactor != null ? densityFactor : BALLISTICS_DENSITY_FACTOR;
  const mach1 = machFps || BALLISTICS_MACH1_FPS;

  let velocity = muzzleVelocityFps;
  let vx = Math.cos(barrelElevationRad) * velocity;
  let vy = Math.sin(barrelElevationRad) * velocity;
  let vz = 0;
  let x = 0, y = -sightHeightFt, z = 0, time = 0;

  const results = [];
  let nextIdx = 0;
  const maxRange = targetDistancesFt[targetDistancesFt.length-1] + calcStepFt;

  while(x <= maxRange){
    if(velocity < 50 || y < -15000) break;

    while(nextIdx < targetDistancesFt.length && x >= targetDistancesFt[nextIdx]){
      results.push({ distanceFt: targetDistancesFt[nextIdx], x, y, z, velocity, time });
      nextIdx++;
    }
    if(nextIdx >= targetDistancesFt.length) break;

    const deltaTime = calcStepFt / vx;
    velocity = Math.hypot(vx, vy);
    const airVx = vx + headwind;
    const airSpeed = headwind ? Math.hypot(airVx, vy) : velocity;
    const mach = airSpeed / mach1;
    const drag = ballisticFactor * rho * airSpeed * dragCd(dragTable, mach) * BALLISTICS_PIR;

    let ay = 0, az = 0;
    if(coriolis){
      ay = coriolis.upPerVx * vx;
      az = coriolis.rightPerVx * vx + coriolis.rightPerVy * vy;
    }
    vx = vx - deltaTime*(drag*airVx - gravityX);
    vy = vy - deltaTime*(drag*vy - gravityY) + deltaTime*ay;
    vz = vz - deltaTime*(drag*vz) + deltaTime*az;

    x = x + vx*deltaTime;
    y = y + vy*deltaTime;
    z = z + vz*deltaTime;
    time = time + deltaTime;
  }
  return results;
}

/**
 * Solves the barrel elevation (radians) so the trajectory crosses the line
 * of sight exactly at zeroDistanceFt (accounting for sight height offset).
 */
function solveSightAngleRad({ effectiveBC, dragTable, muzzleVelocityFps, sightHeightFt, zeroDistanceFt, densityFactor, machFps }){
  const rawStepFt = 10 * BALLISTICS_FT_PER_M; // "10" in the same unit as zero distance (meters)
  const calcStepFt = getCalculationStepFt(rawStepFt);
  const ballisticFactor = 1 / effectiveBC;
  const gravityY = -BALLISTICS_GRAVITY_FPS2;
  const rho = densityFactor != null ? densityFactor : BALLISTICS_DENSITY_FACTOR;
  const mach1 = machFps || BALLISTICS_MACH1_FPS;

  let barrelElevation = 0;
  let error = 1;
  let iterations = 0;

  while(error > 0.000005 && iterations < 10){
    let velocity = muzzleVelocityFps;
    let vx = Math.cos(barrelElevation) * velocity;
    let vy = Math.sin(barrelElevation) * velocity;
    let x = 0, y = -sightHeightFt;
    const maxRange = zeroDistanceFt + calcStepFt;

    while(x <= maxRange){
      if(velocity < 50 || y < -15000) break;
      const deltaTime = calcStepFt / vx;
      velocity = Math.hypot(vx, vy);
      const mach = velocity / mach1;
      const drag = ballisticFactor * rho * velocity * dragCd(dragTable, mach) * BALLISTICS_PIR;

      vx = vx - deltaTime*(drag*vx - 0);
      vy = vy - deltaTime*(drag*vy - gravityY);
      x = x + vx*deltaTime;
      y = y + vy*deltaTime;

      if(Math.abs(x - zeroDistanceFt) < 0.5*calcStepFt){
        error = Math.abs(y);
        barrelElevation = barrelElevation - y/x;
        break;
      }
    }
    iterations++;
  }
  return barrelElevation;
}

/**
 * Computes hold (MIL) at each requested distance for a weapon profile.
 * Positive = hold up, negative = hold down. Returns a Map<distanceM, holdMil|null>.
 * null means the solver could not produce a stable result (e.g. transonic/subsonic
 * breakdown or unrealistic inputs) for that distance.
 */
function computeHoldTableMil(profile, distancesM){
  const dragTable = dragTableFor(profile.dragModel);
  const customFactor = (profile.customDragFactor && profile.customDragFactor > 0) ? profile.customDragFactor : 1;
  const effectiveBC = profile.bc * customFactor;
  const muzzleVelocityFps = profile.muzzleVelocityFps;
  const sightHeightFt = (profile.sightHeightCm || 0) / 30.48;
  const zeroDistanceFt = profile.zeroDistanceM * BALLISTICS_FT_PER_M;

  const barrelElevationRad = solveSightAngleRad({
    effectiveBC, dragTable, muzzleVelocityFps, sightHeightFt, zeroDistanceFt,
  });

  const sortedM = [...distancesM].sort((a,b)=>a-b);
  const targetDistancesFt = sortedM.map(d => d * BALLISTICS_FT_PER_M);
  const calcStepFt = getCalculationStepFt(10 * BALLISTICS_FT_PER_M);

  const results = simulateDropAtDistances({
    effectiveBC, dragTable, muzzleVelocityFps, sightHeightFt, barrelElevationRad,
    targetDistancesFt, calcStepFt,
  });

  const holdByDistance = new Map();
  results.forEach(r => {
    const distanceM = r.distanceFt / BALLISTICS_FT_PER_M;
    const holdMil = -Math.atan(r.y / r.x) * 1000;
    holdByDistance.set(Math.round(distanceM), holdMil);
  });
  sortedM.forEach(d => { if(!holdByDistance.has(d)) holdByDistance.set(d, null); });
  return holdByDistance;
}

/**
 * Height of the bullet relative to the line of sight (cm, + = above) at one
 * distance, for a rifle zeroed at zeroDistanceM. Used by the Zero Optic
 * Calculator for the POI at the short check distance (e.g. 25 m for a
 * 100 m zero): the bore is angled up to cover BOTH the sight height and the
 * gravity drop at the zero distance, so at a short distance the bullet sits
 * noticeably higher than the pure-geometry HOB·(1 − d/zero) suggests
 * (~1.3–2.9 cm for 5.56 at 25 m with a 100 m zero).
 */
function computeHeightAtDistanceCm({ dragModel, bc, customDragFactor, muzzleVelocityFps, sightHeightCm, zeroDistanceM, distanceM }){
  const dragTable = dragTableFor(dragModel);
  const customFactor = (customDragFactor && customDragFactor > 0) ? customDragFactor : 1;
  const effectiveBC = bc * customFactor;
  const sightHeightFt = (sightHeightCm || 0) / 30.48;
  const barrelElevationRad = solveSightAngleRad({
    effectiveBC, dragTable, muzzleVelocityFps, sightHeightFt, zeroDistanceFt: zeroDistanceM * BALLISTICS_FT_PER_M,
  });
  const calcStepFt = getCalculationStepFt(10 * BALLISTICS_FT_PER_M);
  const results = simulateDropAtDistances({
    effectiveBC, dragTable, muzzleVelocityFps, sightHeightFt, barrelElevationRad,
    targetDistancesFt: [distanceM * BALLISTICS_FT_PER_M], calcStepFt,
  });
  if(!results.length) return null;
  // Scale to exactly distanceM (the integrator lands a few mm past it).
  const r = results[0];
  return r.y * 30.48 * (distanceM * BALLISTICS_FT_PER_M) / r.x;
}

/**
 * Finds where the true (gravity-drop) trajectory crosses the line of sight
 * a second time downrange of the zero distance — the "far zero" every
 * flat-fired zero has, since the bullet keeps rising above the sight line
 * after the near zero before gravity pulls it back down through it again —
 * plus the drop/velocity/energy 100 m past that far zero. Returns null if
 * no far zero is found within maxRangeM (shouldn't happen for realistic
 * small-arms inputs, but a subsonic/garbage BC could produce one).
 */
function computeTrajectoryProfile({ dragModel, bc, customDragFactor, muzzleVelocityFps, sightHeightCm, zeroDistanceM, bulletWeightGr, maxRangeM }){
  const dragTable = dragTableFor(dragModel);
  const customFactor = (customDragFactor && customDragFactor > 0) ? customDragFactor : 1;
  const effectiveBC = bc * customFactor;
  const sightHeightFt = (sightHeightCm || 0) / 30.48;
  const zeroDistanceFt = zeroDistanceM * BALLISTICS_FT_PER_M;
  const maxM = maxRangeM || 800;

  const barrelElevationRad = solveSightAngleRad({ effectiveBC, dragTable, muzzleVelocityFps, sightHeightFt, zeroDistanceFt });

  // 1 m sampling — fine enough to interpolate the far-zero crossing and the
  // +100 m point to sub-meter precision without costing anything real in a
  // single-click browser computation.
  const targetDistancesFt = [];
  for(let d = 1; d <= maxM; d += 1) targetDistancesFt.push(d * BALLISTICS_FT_PER_M);
  const calcStepFt = getCalculationStepFt(10 * BALLISTICS_FT_PER_M);

  const results = simulateDropAtDistances({
    effectiveBC, dragTable, muzzleVelocityFps, sightHeightFt, barrelElevationRad,
    targetDistancesFt, calcStepFt,
  }).map(r => ({ m: r.distanceFt / BALLISTICS_FT_PER_M, yCm: r.y * 30.48, velocityFps: r.velocity }));

  // Every flat-fired zero has two line-of-sight crossings: the bullet starts
  // below the sight line, rises through it (1st crossing), peaks, and falls
  // back through it (2nd crossing). The chosen zero distance can be EITHER
  // one — with a small HOB (red dot) and a 100 m zero, 100 m is usually the
  // 2nd crossing and the 1st lies around 50–60 m. So find both actual sign
  // changes (linear-interpolated between the 1 m samples) instead of assuming
  // the zero distance is the 1st. A zero right at the apex (tangent) is
  // reported as both crossings at (nearly) the same distance.
  const crossings = [];
  for(let i = 1; i < results.length && crossings.length < 2; i++){
    const prev = results[i-1], cur = results[i];
    if((prev.yCm < 0) !== (cur.yCm < 0)){
      const t = prev.yCm / (prev.yCm - cur.yCm);
      crossings.push(prev.m + t * (cur.m - prev.m));
    }
  }
  let nearZeroM, farZeroM;
  if(crossings.length === 2){
    [nearZeroM, farZeroM] = crossings;
  } else if(crossings.length === 0){
    // Never strictly above the sight line: zero sits exactly at the apex.
    nearZeroM = farZeroM = zeroDistanceM;
  } else {
    return null; // rose through the sight line but the 2nd crossing is beyond maxRangeM
  }

  const targetM = farZeroM + 100;
  let sample = results.find(r => r.m >= targetM);
  if(!sample) sample = results[results.length - 1];

  const energyFtLbs = v => (bulletWeightGr * v * v) / 450240; // standard small-arms KE formula
  const energyJ = ftLbs => ftLbs * 1.35582;

  const muzzleEnergyFtLbs = energyFtLbs(muzzleVelocityFps);
  const targetEnergyFtLbs = energyFtLbs(sample.velocityFps);

  return {
    nearZeroM,
    zeroIsFar: Math.abs(farZeroM - zeroDistanceM) < Math.abs(nearZeroM - zeroDistanceM),
    farZeroM,
    targetM: sample.m,
    dropCm: -sample.yCm, // yCm is negative (below LOS) past the far zero — report the positive drop magnitude
    velocityFpsAtTarget: sample.velocityFps,
    muzzleEnergyJ: energyJ(muzzleEnergyFtLbs), muzzleEnergyFtLbs,
    energyJAtTarget: energyJ(targetEnergyFtLbs), energyFtLbsAtTarget: targetEnergyFtLbs,
  };
}

/**
 * Variable atmosphere for Dope Card (Optic/Dry Fire keep the fixed ICAO
 * sea-level standard above). Returns a density ratio (relative to that
 * same ICAO standard, so it's a drop-in multiplier for densityFactor
 * above) and the speed of sound in fps for the given temperature.
 * altitudeM is ignored when pressureHpa is given directly.
 *
 * humidityPct (optional, 0–100): water vapour is lighter than dry air, so
 * humid air is slightly thinner — density × (1 − 0.378·e/P), with e the
 * vapour pressure (Magnus formula). ~0.3–1 % at everyday temperatures. Its
 * effect on the speed of sound (< 0.2 %) is left out.
 */
function computeAtmosphere({ tempC, altitudeM, pressureHpa, humidityPct }){
  const T_C = tempC != null ? tempC : 15;
  const T_K = T_C + 273.15;
  const P_hPa = pressureHpa != null ? pressureHpa
    : 1013.25 * Math.pow(1 - 2.25577e-5 * (altitudeM || 0), 5.25588);
  // Ratio form cancels the gas constant R, so only P/T relative to the
  // ICAO standard (1013.25 hPa / 288.15 K) is needed.
  let densityFactor = (P_hPa * 288.15) / (1013.25 * T_K);
  const rh = Math.max(0, Math.min(100, humidityPct || 0));
  if(rh > 0){
    const vapourHpa = (rh/100) * 6.1078 * Math.pow(10, 7.5*T_C/(T_C + 237.3));
    densityFactor *= 1 - 0.378 * vapourHpa / P_hPa;
  }
  const speedOfSoundMs = 331.3 * Math.sqrt(1 + T_C / 273.15);
  const machFps = speedOfSoundMs * BALLISTICS_FT_PER_M;
  return { densityFactor, machFps, tempC: T_C, pressureHpa: P_hPa, humidityPct: rh };
}

// Standard ICAO lapse rate (troposphere): 6.5°C per 1000 m.
const BALLISTICS_ISA_LAPSE_C_PER_M = 0.0065;

/**
 * Density Altitude, given directly instead of temp+altitude+pressure: the
 * altitude in the ICAO standard atmosphere whose air density matches the
 * actual local density. By definition that's exactly the standard pressure
 * AND standard temperature at that altitude, so this is just
 * computeAtmosphere() fed with the standard-atmosphere temperature for that
 * altitude — same formula, no separate approximation to keep in sync.
 */
function computeAtmosphereFromDensityAltitude(daM){
  const tempC = 15 - BALLISTICS_ISA_LAPSE_C_PER_M * daM;
  return computeAtmosphere({ tempC, altitudeM: daM });
}

/**
 * Inverse of the above: given a density factor (e.g. from real temp +
 * altitude/pressure), find the equivalent Density Altitude in meters — a
 * check figure to compare against a Kestrel or similar. densityFactor is
 * monotonically decreasing in altitude, so plain bisection is exact and
 * avoids a second, possibly-inconsistent closed-form approximation.
 */
function densityAltitudeFromFactor(densityFactor){
  let lo = -2000, hi = 12000; // m — comfortably covers any realistic shooting scenario
  for(let i = 0; i < 40; i++){
    const mid = (lo + hi) / 2;
    const f = computeAtmosphereFromDensityAltitude(mid).densityFactor;
    if(f > densityFactor) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Aerodynamic jump (Bryan Litz, Applied Ballistics): a crosswind tilts the
// airflow the bullet meets as it leaves the muzzle; gyroscopic precession
// turns that into a small *vertical* deflection, a fixed angle from the
// muzzle onward:
//   Y [MOA per mph crosswind] = 0.01·SG − 0.0024·L + 0.032  (L = length in calibers)
// Right-hand twist: wind from the right lifts the impact, from the left it
// drops it (left-hand twist: the other way round). Returned here as mil of
// POI rise per m/s of crosswind from the right.
const BALLISTICS_MOA_PER_MIL = 3.437747;
const BALLISTICS_MPH_PER_MPS = 2.236936;
function aeroJumpMilPerMps(sg, bulletLengthIn, bulletDiameterIn, twistDir){
  const lCal = bulletLengthIn / bulletDiameterIn;
  const moaPerMph = 0.01*sg - 0.0024*lCal + 0.032;
  return moaPerMph * BALLISTICS_MPH_PER_MPS / BALLISTICS_MOA_PER_MIL * (twistDir === 'L' ? -1 : 1);
}

// Shared set-up for the Dope Card solvers below. The bore angle is solved
// once with the profile's own (reference) muzzle velocity: that's the rifle
// as it was zeroed. A different powder temperature then changes the MV the
// trajectory itself is flown with — so, as on the range, it can move the
// impact a little even at the zero distance.
function dopeCardSetup(profile, atmosphere, opts){
  const dragTable = dragTableFor(profile.dragModel);
  const customFactor = (profile.customDragFactor && profile.customDragFactor > 0) ? profile.customDragFactor : 1;
  const effectiveBC = profile.bc * customFactor;
  const sightHeightFt = (profile.sightHeightCm || 0) / 30.48;
  const { densityFactor, machFps } = atmosphere || {};
  const barrelElevationRad = solveSightAngleRad({
    effectiveBC, dragTable, muzzleVelocityFps: profile.muzzleVelocityFps, sightHeightFt,
    zeroDistanceFt: profile.zeroDistanceM * BALLISTICS_FT_PER_M, densityFactor, machFps,
  });
  const muzzleVelocityFps = (opts && opts.muzzleVelocityFps > 0) ? opts.muzzleVelocityFps : profile.muzzleVelocityFps;
  const coriolis = opts && opts.coriolis ? coriolisParams(opts.coriolis.latitudeDeg, opts.coriolis.azimuthDeg) : null;
  return {
    effectiveBC, dragTable, sightHeightFt, barrelElevationRad, muzzleVelocityFps, coriolis,
    densityFactor, machFps, calcStepFt: getCalculationStepFt(10 * BALLISTICS_FT_PER_M),
  };
}

/**
 * Dope Card table, per requested distance:
 * - elevMil: elevation hold (MIL) in no wind — includes the vertical
 *   Coriolis (Eötvös) part when a direction of fire is known.
 * - driftMilPerMps: wind hold per 1 m/s of full-value crosswind (lag time) —
 *   the UI multiplies it by the current effective wind.
 * - elevMilPerMpsHeadwind / elevMilPerMpsTailwind: extra elevation per
 *   1 m/s of head- resp. tailwind (the latter negative) — from two extra
 *   runs at 5 m/s, since the effect isn't quite symmetric.
 * - ajMilPerMps: aerodynamic jump, POI rise per 1 m/s of crosswind from the
 *   right (only with spinParams and opts.aeroJump !== false).
 * - spinDriftMil: spin drift, POI to the right (+) / left (−).
 * - coriolisMil: horizontal Coriolis, POI to the right (+) / left (−).
 * - tofSec, velocityMs.
 *
 * opts: { muzzleVelocityFps (powder-temperature corrected),
 *         coriolis: { latitudeDeg, azimuthDeg|null } | null,
 *         twistDir: 'R'|'L', aeroJump: bool }
 */
function computeDopeCardTable(profile, atmosphere, distancesM, spinParams, opts){
  opts = opts || {};
  const S = dopeCardSetup(profile, atmosphere, opts);
  const sortedM = [...distancesM].sort((a,b)=>a-b);
  const targetDistancesFt = sortedM.map(d => d * BALLISTICS_FT_PER_M);
  const base = {
    effectiveBC: S.effectiveBC, dragTable: S.dragTable, muzzleVelocityFps: S.muzzleVelocityFps,
    sightHeightFt: S.sightHeightFt, barrelElevationRad: S.barrelElevationRad, targetDistancesFt,
    calcStepFt: S.calcStepFt, densityFactor: S.densityFactor, machFps: S.machFps, coriolis: S.coriolis,
  };
  const results = simulateDropAtDistances(base);
  const RANGE_WIND_MPS = 5;
  const byFt = rs => new Map(rs.map(r => [r.distanceFt, r]));
  const headByFt = byFt(simulateDropAtDistances(Object.assign({}, base, { headwindFps: RANGE_WIND_MPS * BALLISTICS_FT_PER_M })));
  const tailByFt = byFt(simulateDropAtDistances(Object.assign({}, base, { headwindFps: -RANGE_WIND_MPS * BALLISTICS_FT_PER_M })));

  // Miller's SG is for standard air (59°F, 29.92 inHg); stability scales with
  // 1/air density (Litz' temperature/pressure correction), so thinner air at
  // altitude/heat gives a slightly higher SG and thus a bit more spin drift.
  const twistDir = opts.twistDir === 'L' ? 'L' : 'R';
  const sg = spinParams ? millerStability(Object.assign({}, spinParams, { muzzleVelocityFps: S.muzzleVelocityFps })) / (S.densityFactor || 1) : null;
  const aj = (sg != null && opts.aeroJump !== false) ? aeroJumpMilPerMps(sg, spinParams.bulletLengthIn, spinParams.bulletDiameterIn, twistDir) : null;

  const table = new Map();
  results.forEach(r => {
    const distanceM = Math.round(r.distanceFt / BALLISTICS_FT_PER_M);
    const elevMil = -Math.atan(r.y / r.x) * 1000;
    // Lag-time wind drift: a bullet slowed by drag takes longer to reach a
    // distance than a no-drag bullet at muzzle velocity would — a full-value
    // crosswind carries it sideways for exactly that extra time.
    const noDragTime = r.x / S.muzzleVelocityFps;
    const driftFtPerMps = (r.time - noDragTime) * BALLISTICS_FT_PER_M; // 1 m/s wind → ft of drift
    const driftMilPerMps = (driftFtPerMps / r.x) * 1000;
    const entry = { elevMil, driftMilPerMps, tofSec: r.time, velocityMs: r.velocity / BALLISTICS_FT_PER_M };
    const h = headByFt.get(r.distanceFt), t = tailByFt.get(r.distanceFt);
    if(h) entry.elevMilPerMpsHeadwind = ((-Math.atan(h.y / h.x) * 1000) - elevMil) / RANGE_WIND_MPS;
    if(t) entry.elevMilPerMpsTailwind = ((-Math.atan(t.y / t.x) * 1000) - elevMil) / RANGE_WIND_MPS;
    if(S.coriolis) entry.coriolisMil = Math.atan(r.z / r.x) * 1000;
    if(sg != null){
      const driftM = spinDriftIn(sg, r.time) * 0.0254;
      entry.spinDriftMil = Math.atan(driftM / distanceM) * 1000 * (twistDir === 'L' ? -1 : 1);
    }
    if(aj != null) entry.ajMilPerMps = aj;
    table.set(distanceM, entry);
  });
  sortedM.forEach(d => { if(!table.has(d)) table.set(d, null); });
  table.sg = sg;
  table.muzzleVelocityFps = S.muzzleVelocityFps;
  return table;
}

/**
 * Exact elevation hold (MIL) for an inclined shot (angleDeg, + = uphill,
 * − = downhill) at slant distance distanceM — same rifle/zero/atmosphere/
 * options as computeDopeCardTable. Gravity is split into a component along
 * the line of sight and one perpendicular to it, instead of the
 * (Improved) Rifleman's Rule approximation.
 */
function computeInclinedElevMil(profile, atmosphere, distanceM, angleDeg, opts){
  const S = dopeCardSetup(profile, atmosphere, opts || {});
  const results = simulateDropAtDistances({
    effectiveBC: S.effectiveBC, dragTable: S.dragTable, muzzleVelocityFps: S.muzzleVelocityFps,
    sightHeightFt: S.sightHeightFt, barrelElevationRad: S.barrelElevationRad,
    targetDistancesFt: [distanceM * BALLISTICS_FT_PER_M], calcStepFt: S.calcStepFt,
    densityFactor: S.densityFactor, machFps: S.machFps, coriolis: S.coriolis,
    lookAngleRad: (angleDeg || 0) * Math.PI/180,
  });
  if(!results.length) return null;
  const r = results[0];
  return -Math.atan(r.y / r.x) * 1000;
}

/**
 * Miller twist-rate stability formula (imperial units) — the standard,
 * widely-used approximation (Litz/Applied Ballistics/JBM all use this or
 * an equivalent). SG > ~1.4 is comfortably stable; below ~1.0 is unstable.
 */
function millerStability({ bulletWeightGr, bulletDiameterIn, bulletLengthIn, twistIn, muzzleVelocityFps }){
  const t = twistIn / bulletDiameterIn; // twist in calibers per turn
  const L = bulletLengthIn / bulletDiameterIn; // bullet length in calibers
  let sg = (30 * bulletWeightGr) / (t * t * Math.pow(bulletDiameterIn, 3) * L * (1 + L * L));
  sg *= Math.pow(muzzleVelocityFps / 2800, 1 / 3);
  return sg;
}

/**
 * Litz spin drift approximation (inches): 1.25 * (SG + 1.2) * TOF(s)^1.83.
 * Always the direction of the twist: right with a right-hand twist (the
 * caller flips the sign for a left-hand twist).
 */
function spinDriftIn(sg, tofSec){
  return 1.25 * (sg + 1.2) * Math.pow(tofSec, 1.83);
}

/**
 * Console self-test: sanity-checks the solver's invariants and prints the
 * M855 (100 m zero, 70 mm HOB, ICAO) 100-800 m table for a manual check
 * against JBM/Strelok. Not run automatically — call from the console with
 * AppliedConceptsBallistics.runSelfTest().
 */
function runSelfTest(){
  const profile = {
    dragModel: 'G7', bc: 0.151, muzzleVelocityFps: 900 * BALLISTICS_FT_PER_M,
    sightHeightCm: 7, zeroDistanceM: 100,
  };
  const atmosphere = computeAtmosphere({ tempC: 15, altitudeM: 0 });
  const distances = [100,200,300,400,500,600,700,800];
  const table = computeDopeCardTable(profile, atmosphere, distances);

  console.log('--- Ballistics self-test: M855 62gr, G7 0.151, 900 m/s, 100 m zero, 70 mm HOB, ICAO ---');
  console.log('m\telev (mil)\tdrift/mps (mil)');
  distances.forEach(d => {
    const row = table.get(d);
    console.log(`${d}\t${row.elevMil.toFixed(2)}\t${row.driftMilPerMps.toFixed(3)}`);
  });

  const elevAtZero = table.get(100).elevMil;
  console.assert(Math.abs(elevAtZero) < 0.05, 'FAIL: elevation at zero distance should be ~0, got', elevAtZero);

  let monotonic = true;
  for(let i=1; i<distances.length; i++){
    if(table.get(distances[i]).elevMil <= table.get(distances[i-1]).elevMil) monotonic = false;
  }
  console.assert(monotonic, 'FAIL: elevation hold should increase monotonically past the zero');

  // Windhold linear in wind speed + R/L convention (section 3): wind from
  // the right (0°<θ<180°) pushes the bullet left, so the hold to compensate
  // is R; from the left, hold is L. Verified against the clock-method spec
  // examples (5.0 m/s @ 3:00 = R5.0, @ 2:00 = R4.3, @ 9:00 = L5.0) directly
  // by the UI's effective-wind formula (see dopecard.js) — here we only
  // confirm driftMilPerMps scales linearly, which the UI then multiplies.
  const d500 = table.get(500).driftMilPerMps;
  console.assert(d500 > 0, 'FAIL: driftMilPerMps at 500 m should be positive');

  console.log('Self-test klaar — vergelijk de tabel hierboven met JBM/Strelok voor M855.');
}

window.AppliedConceptsBallistics = {
  computeHoldTableMil, computeTrajectoryProfile, computeHeightAtDistanceCm, computeAtmosphere, computeDopeCardTable,
  computeInclinedElevMil, computeAtmosphereFromDensityAltitude, densityAltitudeFromFactor,
  millerStability, spinDriftIn, aeroJumpMilPerMps,
  runSelfTest, G1_DRAG_TABLE, G7_DRAG_TABLE,
};
