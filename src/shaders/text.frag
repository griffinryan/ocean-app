#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform sampler2D u_sceneTexture;   // Combined ocean + glass scene
uniform sampler2D u_textTexture;    // Text mask texture from Canvas
uniform float u_adaptiveStrength;   // Strength of adaptive coloring
uniform float u_textIntroProgress;  // Text intro animation progress (0.0 = start, 1.0 = complete)

out vec4 fragColor;

// Panel positions and sizes for boundary checking (matching GlassRenderer approach)
uniform vec2 u_panelPositions[5];  // Panel center positions in screen space [-1,1]
uniform vec2 u_panelSizes[5];      // Panel sizes in screen space
uniform int u_panelCount;

// Vessel wake uniforms (from ocean system for glow distortion)
uniform int u_vesselCount;
uniform vec3 u_vesselPositions[5];
uniform vec3 u_vesselVelocities[5];
uniform float u_vesselWeights[5];
uniform float u_vesselHullLengths[5];
uniform float u_vesselStates[5];
uniform bool u_wakesEnabled;

// Glow control uniforms
uniform float u_glowRadius;          // Glow radius in pixels (default: 8.0)
uniform float u_glowIntensity;       // Glow intensity multiplier (default: 0.8)
uniform float u_glowWaveReactivity;  // How much waves affect glow (default: 0.4)

// Adaptive coloring constants
const float LUMINANCE_THRESHOLD = 0.5;
const vec3 DARK_TEXT_COLOR = vec3(0.0, 0.0, 0.0);   // Black for light backgrounds
const vec3 LIGHT_TEXT_COLOR = vec3(1.0, 1.0, 1.0);  // White for dark backgrounds

// 4x4 Bayer dithering matrix for ordered dithering patterns (from ocean.frag)
float bayerDither4x4(vec2 position) {
    // Bayer matrix values normalized to [0,1]
    int x = int(mod(position.x, 4.0));
    int y = int(mod(position.y, 4.0));

    // 4x4 Bayer matrix
    float bayerMatrix[16] = float[16](
        0.0/16.0,  8.0/16.0,  2.0/16.0,  10.0/16.0,
        12.0/16.0, 4.0/16.0,  14.0/16.0, 6.0/16.0,
        3.0/16.0,  11.0/16.0, 1.0/16.0,  9.0/16.0,
        15.0/16.0, 7.0/16.0,  13.0/16.0, 5.0/16.0
    );

    return bayerMatrix[y * 4 + x];
}

// Enhanced luminance calculation with blue emphasis for ocean scenes
float calculateLuminance(vec3 color) {
    // Standard luminance weights with slight blue emphasis for ocean
    return dot(color, vec3(0.299, 0.587, 0.200));
}

// Quantize color for stylized look (from ocean.frag)
vec3 quantizeColor(vec3 color, int levels) {
    return floor(color * float(levels) + 0.5) / float(levels);
}

// Fast adaptive color selection using step function
vec3 calculateAdaptiveTextColor(vec3 backgroundColor, float adaptiveStrength) {
    float luminance = calculateLuminance(backgroundColor);

    // Simple step function for performance (instead of smoothstep)
    float colorMix = step(LUMINANCE_THRESHOLD, luminance);

    // Mix between dark and light text colors
    vec3 adaptiveColor = mix(LIGHT_TEXT_COLOR, DARK_TEXT_COLOR, colorMix);

    // Apply adaptive strength
    return mix(LIGHT_TEXT_COLOR, adaptiveColor, adaptiveStrength);
}

// Cubic ease-out function for smooth intro animation settling
float cubicEaseOut(float t) {
    float f = t - 1.0;
    return f * f * f + 1.0;
}

// Hash function for procedural noise (from ocean.frag)
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Improved noise function for organic distortion
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// ===== WAVE PHYSICS FUNCTIONS (from ocean.frag) =====

const float PI = 3.14159265359;
const float KELVIN_ANGLE = 0.34; // ~19.47 degrees in radians
const float GRAVITY = 9.81;

// Rotate 2D vector by angle (in radians)
vec2 rotate2D(vec2 v, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

// Calculate wave number from wavelength
float waveNumber(float wavelength) {
    return 2.0 * PI / wavelength;
}

// Deep water dispersion relation: omega = sqrt(g * k)
float waveFrequency(float k) {
    return sqrt(GRAVITY * k);
}

// Simple sine wave for procedural ocean
float sineWave(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float time) {
    float k = 2.0 * PI / wavelength;
    float phase = k * dot(direction, pos) - speed * time;
    return amplitude * sin(phase);
}

// Simplified trail decay function
float getSimplifiedTrailDecay(float normalizedDistance, float weight) {
    float decay = exp(-normalizedDistance * 2.5);
    float modulation = 1.0 - normalizedDistance * 0.3;
    float weightFactor = 1.0 + weight * 0.2;
    return max(0.0, decay * modulation * weightFactor);
}

// Calculate vessel wake contribution (simplified for glow distortion)
float calculateVesselWakeForGlow(vec2 pos, vec3 vesselPos, vec3 vesselVel, float weight, float hullLength, float vesselState, float time) {
    vec2 delta = pos - vesselPos.xz;
    float distance = length(delta);

    vec2 vesselDir = normalize(vesselVel.xz);
    float vesselSpeed = length(vesselVel.xz);

    if (vesselSpeed < 0.1) return 0.0;

    float maxTrailDistance = 80.0 + weight * 25.0;
    float wakeRange = 25.0 + weight * 15.0 + vesselSpeed * 4.0;

    if (distance > 120.0) return 0.0;

    float dotProduct = dot(delta, vesselDir);
    if (dotProduct > 0.0) return 0.0;

    float pathDistance = abs(dotProduct);
    if (pathDistance > maxTrailDistance) return 0.0;

    float froudeNumber = vesselSpeed / sqrt(GRAVITY * hullLength);
    float baseAngle = KELVIN_ANGLE * (1.0 + weight * 0.8);
    float froudeModifier = 1.0 + froudeNumber * 0.2;
    float shearRate = 0.15;
    float progressiveShear = 1.0 + shearRate * log(1.0 + pathDistance * 0.1);
    float dynamicAngle = baseAngle * froudeModifier * progressiveShear;

    vec2 leftArm = rotate2D(vesselDir, dynamicAngle);
    vec2 rightArm = rotate2D(vesselDir, -dynamicAngle);

    float leftDist = abs(dot(delta, vec2(-leftArm.y, leftArm.x)));
    float rightDist = abs(dot(delta, vec2(-rightArm.y, rightArm.x)));

    float stateIntensity = 1.0;
    if (vesselState > 0.5 && vesselState < 1.5) {
        stateIntensity = 0.7;
    } else if (vesselState > 1.5) {
        float fadeFactor = (vesselState - 2.0);
        stateIntensity = 0.7 * (1.0 - fadeFactor);
    }

    float baseAmplitude = vesselSpeed * (0.15 + weight * 0.25) * stateIntensity;
    float normalizedPathDistance = min(pathDistance / maxTrailDistance, 1.0);
    float simplifiedDecay = getSimplifiedTrailDecay(normalizedPathDistance, weight);

    float edgeFade = 1.0;
    if (distance > wakeRange * 0.6) {
        float t = (distance - wakeRange * 0.6) / (wakeRange * 0.4);
        edgeFade = 1.0 - smoothstep(0.0, 1.0, t);
    }

    float ageFactor = simplifiedDecay;
    float baseWakeWidth = 2.0 + weight * 3.0;
    float spreadFactor = 1.0 + log(pathDistance + 1.0) * 0.3;
    float curlSpread = 1.0 + progressiveShear * 0.2;
    float effectiveWidth = baseWakeWidth * spreadFactor * curlSpread;

    float wakeHeight = 0.0;
    float phi = 1.618;

    // Simplified to single wave component for performance
    if (leftDist < effectiveWidth) {
        float armIntensity = smoothstep(effectiveWidth, effectiveWidth * 0.3, leftDist);
        float wavelength = 2.5 + vesselSpeed * 0.5;
        float k = waveNumber(wavelength);
        float omega = waveFrequency(k);
        float phase = k * pathDistance - omega * time;
        wakeHeight += baseAmplitude * armIntensity * ageFactor * edgeFade * sin(phase);
    }

    if (rightDist < effectiveWidth) {
        float armIntensity = smoothstep(effectiveWidth, effectiveWidth * 0.3, rightDist);
        float wavelength = 2.5 + vesselSpeed * 0.5;
        float k = waveNumber(wavelength);
        float omega = waveFrequency(k);
        float phase = k * pathDistance - omega * time;
        wakeHeight += baseAmplitude * armIntensity * ageFactor * edgeFade * sin(phase);
    }

    return wakeHeight * 1.5;
}

// Calculate all vessel wake contributions for glow
float getAllVesselWakesForGlow(vec2 pos, float time) {
    if (!u_wakesEnabled || u_vesselCount == 0) return 0.0;

    float totalWake = 0.0;
    for (int i = 0; i < u_vesselCount && i < 5; i++) {
        totalWake += calculateVesselWakeForGlow(pos, u_vesselPositions[i], u_vesselVelocities[i],
                                                u_vesselWeights[i], u_vesselHullLengths[i], u_vesselStates[i], time);
    }

    return totalWake;
}

// Calculate ocean height at position (simplified procedural waves for glow distortion)
float getOceanHeightForGlow(vec2 pos, float time) {
    float height = 0.0;

    // Simplified wave set for performance
    height += sineWave(pos, vec2(1.0, 0.0), 8.0, 0.4, 1.0, time);
    height += sineWave(pos, vec2(0.7, 0.7), 6.0, 0.3, 1.2, time);
    height += sineWave(pos, vec2(0.0, 1.0), 10.0, 0.35, 0.8, time);

    // Add vessel wakes
    float wakeHeight = getAllVesselWakesForGlow(pos, time);
    height += wakeHeight;

    return height;
}

// ===== GLOW SYSTEM FUNCTIONS =====

// Calculate distance field from text (OPTIMIZED - reduced from 24 to 8 samples)
float calculateGlowDistance(vec2 uv, vec2 pixelSize) {
    float minDistance = u_glowRadius;

    // 8-direction sampling pattern for distance field
    const int numSamples = 8;
    const float angleStep = 2.0 * PI / float(numSamples);

    // Single-ring sampling (3x faster than before, similar visual quality)
    // Use adaptive radius based on glow radius for good coverage
    float adaptiveRadius = u_glowRadius * 0.5;
    vec2 radiusOffset = pixelSize * adaptiveRadius;

    for (int i = 0; i < numSamples; i++) {
        float angle = float(i) * angleStep;
        vec2 direction = vec2(cos(angle), sin(angle));
        vec2 sampleUV = uv + direction * radiusOffset;

        float sampleAlpha = texture(u_textTexture, sampleUV).a;

        if (sampleAlpha > 0.01) {
            float dist = length(direction * radiusOffset * u_resolution.x);
            minDistance = min(minDistance, dist);
        }
    }

    return minDistance;
}

// Calculate glow intensity from distance with neon-like falloff
float calculateGlowIntensity(float distance) {
    // Tighter sigma for brighter core (neon effect)
    float sigma = u_glowRadius * 0.3;
    float normalizedDist = distance / sigma;

    // Gaussian falloff with power boost for bright core
    float gaussian = exp(-0.5 * normalizedDist * normalizedDist);
    float coreBoost = pow(gaussian, 0.7); // Power < 1 boosts core brightness

    return coreBoost * u_glowIntensity;
}

// Calculate glow color with sharp quantized transitions (inverse of text)
vec3 calculateGlowColor(vec3 backgroundColor, float glowIntensity, float oceanHeight, vec2 fragCoord) {
    // Define color stops: White → Blue → Ochre-yellow (inverse of text)
    vec3 whiteGlow = vec3(1.0, 1.0, 1.0);        // Low waves (inverse of dark text)
    vec3 blueGlow = vec3(0.2, 0.4, 0.8);         // Mid waves
    vec3 ochreGlow = vec3(0.8, 0.6, 0.2);        // High waves (inverse of white text)

    // Normalize wave height to 0-1 range
    // Wave heights typically range from -1.5 to 1.5
    float normalizedWave = clamp((oceanHeight + 1.5) / 3.0, 0.0, 1.0);

    // Apply Bayer dithering for stylized quantization (matching text aesthetic)
    float dither = bayerDither4x4(fragCoord);
    float ditheredWave = normalizedWave + (dither - 0.5) * 0.2;

    // Sharp step transitions at 0.33 and 0.66 thresholds
    float lowStep = step(0.33, ditheredWave);   // 0 if wave < 0.33, 1 if >= 0.33
    float highStep = step(0.66, ditheredWave);  // 0 if wave < 0.66, 1 if >= 0.66

    // Select color based on steps (sharp transitions)
    vec3 glowColor;
    if (highStep > 0.5) {
        // High waves: ochre-yellow
        glowColor = ochreGlow;
    } else if (lowStep > 0.5) {
        // Mid waves: blue
        glowColor = blueGlow;
    } else {
        // Low waves: white
        glowColor = whiteGlow;
    }

    // Apply quantization to 8 levels (matching text quantization)
    glowColor = quantizeColor(glowColor, 8);

    return glowColor;
}

// Check if current fragment is within any panel boundary (from GlassRenderer)
bool isWithinPanel(vec2 screenPos, out vec2 panelUV) {
    for (int i = 0; i < u_panelCount && i < 5; i++) {
        // Convert screen position to panel-relative coordinates
        vec2 panelCenter = (u_panelPositions[i] + 1.0) * 0.5; // Convert from [-1,1] to [0,1]
        vec2 panelHalfSize = u_panelSizes[i] * 0.5;

        // Calculate position relative to panel center
        vec2 deltaFromCenter = screenPos - panelCenter;
        vec2 localPanelUV = deltaFromCenter / panelHalfSize + 0.5;

        // Check if within panel bounds
        if (localPanelUV.x >= 0.0 && localPanelUV.x <= 1.0 &&
            localPanelUV.y >= 0.0 && localPanelUV.y <= 1.0) {
            panelUV = localPanelUV;
            return true;
        }
    }
    return false;
}

void main() {
    // Convert screen position to UV coordinates [0,1]
    vec2 screenUV = (v_screenPos + 1.0) * 0.5;

    // Check if we're within any panel boundary
    vec2 panelUV;
    if (!isWithinPanel(screenUV, panelUV)) {
        discard; // Only render text within panels
    }

    // Sample the background scene (ocean + glass combined)
    vec3 backgroundColor = texture(u_sceneTexture, screenUV).rgb;

    // ===== CALCULATE OCEAN WAVE DISTORTION FOR GLOW =====
    // Convert screen position to ocean coordinates
    vec2 oceanPos = v_screenPos * 15.0;
    oceanPos.x *= u_aspectRatio;

    // Get ocean height at current position
    float oceanHeight = getOceanHeightForGlow(oceanPos, v_time);

    // Calculate wave-based distortion offset
    float waveDistortion = oceanHeight * u_glowWaveReactivity;

    // ===== TEXT INTRO ANIMATION =====
    // Calculate distortion amount based on intro progress
    float eased = cubicEaseOut(u_textIntroProgress);
    float distortionAmount = 1.0 - eased; // 1.0 at start, 0.0 at end

    // Multi-frequency sine waves for organic wiggly motion
    float wave1 = sin(screenUV.y * 30.0 + v_time * 8.0) * 0.12;
    float wave2 = sin(screenUV.x * 20.0 - v_time * 6.0) * 0.08;
    float wave3 = sin((screenUV.x + screenUV.y) * 25.0 + v_time * 7.0) * 0.06;

    // Low-frequency wave for deep amplitude sway
    float deepWave = sin(screenUV.y * 8.0 + v_time * 3.0) * 0.20;

    // Organic noise variation
    float noiseValue = noise(screenUV * 12.0 + v_time * 1.5) * 0.04;

    // Combine all distortions (intro animation + wave distortion)
    vec2 distortion = vec2(
        wave1 + wave3 + deepWave + noiseValue,
        wave2 + wave3 + noiseValue
    );

    // Add wave-based distortion for glow reactivity
    vec2 waveDistortionVec = vec2(
        sin(oceanPos.y * 0.5 + v_time) * waveDistortion,
        cos(oceanPos.x * 0.5 + v_time) * waveDistortion
    ) * 0.01;

    // Apply combined distortion scaled by animation progress
    vec2 totalDistortion = distortion * distortionAmount + waveDistortionVec;
    vec2 distortedUV = screenUV + totalDistortion;

    // Sample the text texture with distorted UV coordinates
    float textAlpha = texture(u_textTexture, distortedUV).a;

    // ===== RENDER TEXT OR GLOW =====
    vec3 finalColor;
    float finalAlpha;

    if (textAlpha > 0.01) {
        // ===== TEXT RENDERING PATH (EXISTING LOGIC) =====

        // Calculate adaptive text color based on background
        vec3 adaptiveTextColor = calculateAdaptiveTextColor(backgroundColor, u_adaptiveStrength);

        // Quantize the adaptive color to match ocean's stylized look
        vec3 quantizedColor = quantizeColor(adaptiveTextColor, 8);

        // Use clean quantized color without dithering
        finalColor = quantizedColor;

        // Gentle anti-aliasing for text edges
        finalAlpha = smoothstep(0.1, 0.5, textAlpha);

    } else {
        // ===== GLOW RENDERING PATH (NEW LOGIC) =====

        // Calculate pixel size for distance field sampling
        vec2 pixelSize = 1.0 / u_resolution;

        // Calculate distance to nearest text with wave distortion
        float glowDistance = calculateGlowDistance(distortedUV, pixelSize);

        // Check if within glow radius
        if (glowDistance < u_glowRadius) {
            // Calculate glow intensity with Gaussian falloff
            float glowIntensity = calculateGlowIntensity(glowDistance);

            // Add wave reactivity to glow intensity
            float waveBoost = abs(oceanHeight) * 0.15;
            glowIntensity += waveBoost * glowIntensity;

            // Calculate glow color based on wave height with dithered color range
            vec3 glowColor = calculateGlowColor(backgroundColor, glowIntensity, oceanHeight, gl_FragCoord.xy);

            // Apply intro animation to glow (slightly offset from text)
            float glowAnimationFactor = 1.0 - cubicEaseOut(max(0.0, u_textIntroProgress - 0.1));
            glowIntensity *= (1.0 - glowAnimationFactor * 0.5);

            finalColor = glowColor;
            finalAlpha = glowIntensity;
        } else {
            // Outside glow radius - discard
            discard;
        }
    }

    // ===== APPLY PANEL EDGE FADE =====
    float edgeFade = 1.0;
    float fadeWidth = 0.05; // 5% fade at edges
    edgeFade *= smoothstep(0.0, fadeWidth, panelUV.x);
    edgeFade *= smoothstep(0.0, fadeWidth, panelUV.y);
    edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.x);
    edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.y);

    // Apply edge fade to alpha
    finalAlpha *= edgeFade;

    // Ensure proper values
    finalColor = clamp(finalColor, vec3(0.0), vec3(1.0));

    fragColor = vec4(finalColor, finalAlpha);
}