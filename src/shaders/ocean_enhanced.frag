#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform int u_debugMode;

// Environmental parameters
uniform float u_windSpeed;
uniform vec2 u_windDirection;
uniform float u_oceanDepth;
uniform float u_waveAmplitude;

// Texture inputs from various systems
uniform sampler2D u_heightField;     // FFT-generated height displacement
uniform sampler2D u_normalField;     // FFT-generated normals
uniform sampler2D u_velocityField;   // Navier-Stokes velocity field
uniform sampler2D u_foamTexture;     // Accumulated foam texture
uniform sampler2D u_rippleTexture;   // Surface ripples

// Wave parameters
uniform float u_time_scale;
uniform float u_wave_choppiness;
uniform float u_foam_coverage;

out vec4 fragColor;

// Physically-based saltwater ocean color palette based on absorption/scattering research
const vec3 DEEP_OCEAN = vec3(0.004, 0.016, 0.047);      // Very deep water - minimal blue penetration
const vec3 MID_DEPTH_OCEAN = vec3(0.011, 0.058, 0.118); // Mid-depth - rich ocean blue
const vec3 SHALLOW_OCEAN = vec3(0.039, 0.176, 0.282);   // Shallow areas - blue-green transition
const vec3 SURFACE_SCATTER = vec3(0.085, 0.239, 0.392); // Surface scattering - lighter blue
const vec3 FOAM_NASCENT = vec3(0.98, 0.98, 1.0);        // Fresh breaking foam - pure white
const vec3 FOAM_MATURE = vec3(0.89, 0.94, 0.97);        // Mature foam - slightly gray
const vec3 FOAM_DECAY = vec3(0.76, 0.86, 0.91);         // Decaying foam - more gray
const vec3 CAUSTIC_COLOR = vec3(0.15, 0.4, 0.75);       // Underwater caustics - blue bias

// Absorption coefficients for RGB wavelengths (per meter)
const vec3 WATER_ABSORPTION = vec3(0.45, 0.08, 0.015);  // Red absorbed most, blue least
// Scattering coefficients for molecular (Rayleigh) scattering
const vec3 RAYLEIGH_SCATTER = vec3(0.0025, 0.0117, 0.0394); // Blue scatters most

// Improved noise functions
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

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

float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for(int i = 0; i < 8; i++) {
        if(i >= octaves) break;
        value += amplitude * noise(frequency * p);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// Gerstner wave function (for fallback/additional waves)
vec2 gerstnerWave(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float steepness, float time) {
    float k = 2.0 * 3.14159265 / wavelength;
    float c = sqrt(9.8 / k); // Wave speed from physics
    vec2 d = normalize(direction);
    float f = k * (dot(d, pos) - c * speed * time);
    float a = steepness / k;

    return vec2(
        d.x * (a * amplitude * sin(f)),
        amplitude * cos(f)
    );
}

// Enhanced wave height calculation combining FFT and procedural
float getOceanHeight(vec2 pos, float time) {
    // Sample FFT-generated height field
    float fftHeight = texture(u_heightField, v_uv).r;

    // Add procedural Gerstner waves for additional detail
    vec2 gerstner1 = gerstnerWave(pos, u_windDirection, 12.0, 0.8, 1.0, 0.5, time);
    vec2 gerstner2 = gerstnerWave(pos, u_windDirection + vec2(0.3, -0.2), 8.0, 0.6, 1.2, 0.4, time);
    vec2 gerstner3 = gerstnerWave(pos, u_windDirection + vec2(-0.4, 0.5), 15.0, 0.7, 0.8, 0.3, time);

    float proceduralHeight = gerstner1.y + gerstner2.y + gerstner3.y;

    // Combine FFT and procedural waves
    float totalHeight = fftHeight * u_waveAmplitude + proceduralHeight * 0.3;

    // Add fine-scale noise for texture
    vec2 noisePos = pos * 5.0 + time * 0.5;
    totalHeight += fbm(noisePos, 4) * 0.05;

    return totalHeight;
}

// Calculate enhanced normal with multiple sources
vec3 calculateNormal(vec2 pos, float time) {
    // Sample FFT-generated normal
    vec3 fftNormal = texture(u_normalField, v_uv).rgb * 2.0 - 1.0;

    // Calculate procedural normal from height differences
    float eps = 0.1;
    float heightL = getOceanHeight(pos - vec2(eps, 0.0), time);
    float heightR = getOceanHeight(pos + vec2(eps, 0.0), time);
    float heightD = getOceanHeight(pos - vec2(0.0, eps), time);
    float heightU = getOceanHeight(pos + vec2(0.0, eps), time);

    vec3 proceduralNormal = normalize(vec3(heightL - heightR, 2.0 * eps, heightD - heightU));

    // Sample surface ripples normal
    vec3 rippleNormal = texture(u_rippleTexture, v_uv).rgb * 2.0 - 1.0;

    // Combine normals
    vec3 finalNormal = normalize(fftNormal * 0.6 + proceduralNormal * 0.3 + rippleNormal * 0.1);

    return finalNormal;
}

// Calculate wave Jacobian determinant for breaking detection
float calculateWaveJacobian(vec2 pos, float time) {
    float eps = 0.01;

    // Sample height at four points to calculate partial derivatives
    float h_x1 = getOceanHeight(pos + vec2(eps, 0.0), time);
    float h_x2 = getOceanHeight(pos - vec2(eps, 0.0), time);
    float h_y1 = getOceanHeight(pos + vec2(0.0, eps), time);
    float h_y2 = getOceanHeight(pos - vec2(0.0, eps), time);

    // Calculate partial derivatives
    float dh_dx = (h_x1 - h_x2) / (2.0 * eps);
    float dh_dy = (h_y1 - h_y2) / (2.0 * eps);

    // Jacobian determinant for 2D displacement field
    // For wave breaking detection, we look for where Jacobian < 0
    float J = 1.0 - (dh_dx * dh_dx + dh_dy * dh_dy);

    return J;
}

// Enhanced wave steepness calculation
float calculateWaveSteepness(vec2 pos, float time) {
    float eps = 0.05;

    // Calculate gradient magnitude
    float h_center = getOceanHeight(pos, time);
    float h_right = getOceanHeight(pos + vec2(eps, 0.0), time);
    float h_up = getOceanHeight(pos + vec2(0.0, eps), time);

    vec2 gradient = vec2(h_right - h_center, h_up - h_center) / eps;
    float steepness = length(gradient);

    // Also check local curvature for sharp crests
    float h_left = getOceanHeight(pos - vec2(eps, 0.0), time);
    float h_down = getOceanHeight(pos - vec2(0.0, eps), time);

    float curvatureX = (h_right - 2.0 * h_center + h_left) / (eps * eps);
    float curvatureY = (h_up - 2.0 * h_center + h_down) / (eps * eps);
    float curvature = abs(curvatureX) + abs(curvatureY);

    return steepness + curvature * 0.1;
}

// Multi-stage foam calculation with physics-based breaking
vec4 calculateFoam(vec2 pos, float time, float waveHeight, vec2 velocity) {
    // Sample pre-computed foam texture
    float baseFoam = texture(u_foamTexture, v_uv).r;

    // Calculate wave breaking indicators
    float jacobian = calculateWaveJacobian(pos, time);
    float steepness = calculateWaveSteepness(pos, time);

    // Breaking occurs when Jacobian becomes negative (wave folding)
    float breakingIntensity = smoothstep(0.1, -0.2, jacobian);

    // Steepness-based breaking (Stokes limiting steepness ≈ 0.44)
    float steepnessBreaking = smoothstep(0.3, 0.6, steepness);

    // Velocity-based breaking (whitecaps start at ~5 m/s)
    float speed = length(velocity);
    float velocityBreaking = smoothstep(0.12, 0.35, speed);

    // Wind speed effect on foam coverage
    float windEffect = clamp(length(u_windDirection) * u_windSpeed / 10.0, 0.0, 1.0);

    // Height-based foam for wave crests
    float crestFoam = smoothstep(0.4, 0.7, waveHeight + 0.5);

    // Active breaking foam (stage A - bright white)
    float activeFoam = max(breakingIntensity, steepnessBreaking) * velocityBreaking;
    activeFoam = mix(activeFoam, activeFoam * crestFoam, 0.5);

    // Residual foam (stage B - fading white)
    vec2 residualPos = pos + normalize(u_windDirection) * time * 1.5;
    float residualNoise = fbm(residualPos * 12.0, 4);
    float residualFoam = smoothstep(0.7, 0.9, residualNoise) * baseFoam * 0.6;

    // Foam streaks along wind direction
    vec2 windNorm = normalize(u_windDirection);
    vec2 streakPos = pos + windNorm * time * 2.0;
    float foamStreaks = fbm(streakPos * 8.0, 3);
    foamStreaks = smoothstep(0.75, 0.95, foamStreaks) * windEffect * 0.4;

    // Combine foam types with different characteristics
    float totalActiveFoam = clamp(activeFoam + crestFoam * 0.3, 0.0, 1.0);
    float totalResidualFoam = clamp(residualFoam + foamStreaks, 0.0, 1.0);
    float totalBaseFoam = clamp(baseFoam * 0.2, 0.0, 1.0);

    // Apply foam coverage parameter
    totalActiveFoam *= u_foam_coverage;
    totalResidualFoam *= u_foam_coverage * 0.7;
    totalBaseFoam *= u_foam_coverage * 0.4;

    // Return foam stages: x=active, y=residual, z=base, w=combined
    float combinedFoam = max(totalActiveFoam, max(totalResidualFoam, totalBaseFoam));

    return vec4(totalActiveFoam, totalResidualFoam, totalBaseFoam, combinedFoam);
}

// Enhanced caustics calculation
float calculateCaustics(vec2 pos, float time, vec3 normal) {
    // Multiple layers of caustics with different scales and speeds
    vec2 causticPos1 = pos * 25.0 + time * 3.0;
    vec2 causticPos2 = pos * 40.0 - time * 2.5;
    vec2 causticPos3 = pos * 15.0 + time * 4.0;

    float caustic1 = fbm(causticPos1, 3);
    float caustic2 = fbm(causticPos2, 3);
    float caustic3 = fbm(causticPos3, 3);

    caustic1 = smoothstep(0.65, 0.9, caustic1);
    caustic2 = smoothstep(0.7, 0.95, caustic2);
    caustic3 = smoothstep(0.6, 0.85, caustic3);

    // Modulate caustics based on surface normal (focus light)
    float lightFocus = max(0.0, dot(normal, vec3(0.0, 1.0, 0.0)));
    lightFocus = pow(lightFocus, 2.0);

    float totalCaustics = (caustic1 * 0.4 + caustic2 * 0.3 + caustic3 * 0.3) * lightFocus;

    return totalCaustics;
}

// Calculate light attenuation using Beer-Lambert law
vec3 calculateLightAttenuation(float depth) {
    // Beer-Lambert law: I = I0 * exp(-absorption_coefficient * distance)
    return exp(-WATER_ABSORPTION * max(depth, 0.1));
}

// Calculate Rayleigh scattering contribution
vec3 calculateRayleighScattering(float depth, vec3 lightDir, vec3 viewDir) {
    float scatterPhase = 1.0 + 0.75 * pow(dot(lightDir, viewDir), 2.0);
    vec3 scatterAmount = RAYLEIGH_SCATTER * scatterPhase;

    // Scattering decreases with depth
    float depthFactor = exp(-depth * 0.05);
    return scatterAmount * depthFactor;
}

// Physically-based depth color calculation
vec3 calculateDepthColor(float depth, float waveHeight, vec3 lightDir, vec3 viewDir) {
    // Base color starts as pure water color (deep blue)
    vec3 baseWaterColor = DEEP_OCEAN;

    // Calculate light attenuation
    vec3 attenuation = calculateLightAttenuation(depth);

    // Apply Beer-Lambert law to modify color
    vec3 attenuatedColor = baseWaterColor * attenuation;

    // Add Rayleigh scattering for blue coloration
    vec3 scattering = calculateRayleighScattering(depth, lightDir, viewDir);

    // Blend based on depth - deeper water shows more absorption effects
    float depthBlend = 1.0 - exp(-depth * 0.02);
    vec3 finalColor = mix(SURFACE_SCATTER, attenuatedColor, depthBlend);

    // Add scattering contribution
    finalColor += scattering * 0.3;

    // Wave height affects surface reflection and perceived depth
    float surfaceEffect = exp(-depth * 0.1) * (waveHeight * 0.5 + 0.5);
    finalColor = mix(finalColor, SHALLOW_OCEAN, surfaceEffect * 0.2);

    return finalColor;
}

// Calculate Fresnel reflection coefficient
float calculateFresnel(vec3 viewDir, vec3 normal, float ior) {
    // Schlick's approximation for Fresnel reflectance
    float f0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
    float cosTheta = max(0.0, dot(viewDir, normal));
    return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

// Approximate subsurface scattering
vec3 calculateSubsurfaceScattering(vec3 lightDir, vec3 viewDir, vec3 normal, float depth) {
    // Simple subsurface scattering approximation
    vec3 scatterDir = lightDir + normal * 0.3;
    float scatterDot = pow(clamp(dot(viewDir, -scatterDir), 0.0, 1.0), 4.0);

    // Scattering is stronger in shallow water and decreases with depth
    float depthFactor = exp(-depth * 0.1);
    vec3 scatterColor = SHALLOW_OCEAN * 0.5;

    return scatterColor * scatterDot * depthFactor;
}

// Quantize color for stylized look
vec3 quantizeColor(vec3 color, int levels) {
    return floor(color * float(levels) + 0.5) / float(levels);
}

void main() {
    // Convert screen position to ocean coordinates
    vec2 oceanPos = v_screenPos * 30.0;
    oceanPos.x *= u_aspectRatio;

    // Debug mode outputs
    if (u_debugMode == 1) {
        // Show FFT height field
        float height = texture(u_heightField, v_uv).r;
        fragColor = vec4(vec3(height + 0.5), 1.0);
        return;
    } else if (u_debugMode == 2) {
        // Show velocity field
        vec2 velocity = texture(u_velocityField, v_uv).rg;
        fragColor = vec4(velocity * 0.5 + 0.5, 0.0, 1.0);
        return;
    } else if (u_debugMode == 3) {
        // Show surface normals
        vec3 normal = calculateNormal(oceanPos, v_time);
        fragColor = vec4(normal * 0.5 + 0.5, 1.0);
        return;
    }

    // Sample velocity field
    vec2 velocity = texture(u_velocityField, v_uv).rg;

    // Calculate wave height
    float waveHeight = getOceanHeight(oceanPos, v_time);

    // Calculate surface normal
    vec3 normal = calculateNormal(oceanPos, v_time);

    // Multi-source lighting setup
    vec3 sunDir = normalize(vec3(0.6, 1.0, 0.4));
    vec3 viewDir = normalize(vec3(0.0, 1.0, 0.0)); // Top-down view

    // Calculate physically-based ocean color with depth effects
    vec3 baseColor = calculateDepthColor(u_oceanDepth, waveHeight, sunDir, viewDir);

    // Calculate multi-stage foam
    vec4 foamData = calculateFoam(oceanPos, v_time, waveHeight, velocity);
    float activeFoam = foamData.x;
    float residualFoam = foamData.y;
    float baseFoam = foamData.z;
    float totalFoam = foamData.w;

    // Calculate caustics
    float caustics = calculateCaustics(oceanPos, v_time, normal);

    // Enhanced lighting with Fresnel and subsurface scattering
    vec3 moonDir = normalize(vec3(-0.3, 0.8, -0.5));
    vec3 ambientDir = normalize(vec3(0.0, 1.0, 0.0));

    // Calculate Fresnel reflection (water has IOR ≈ 1.33)
    float fresnel = calculateFresnel(viewDir, normal, 1.33);

    // Calculate subsurface scattering
    vec3 subsurfaceScatter = calculateSubsurfaceScattering(sunDir, viewDir, normal, u_oceanDepth);

    // Standard lighting
    float sunLight = max(0.0, dot(normal, sunDir));
    float moonLight = max(0.0, dot(normal, moonDir)) * 0.3;
    float ambientLight = max(0.2, dot(normal, ambientDir)) * 0.5;

    float totalLighting = sunLight + moonLight + ambientLight;
    totalLighting = clamp(totalLighting, 0.3, 1.5);

    // Apply lighting to base color
    baseColor *= totalLighting;

    // Add subsurface scattering contribution
    baseColor += subsurfaceScatter * 0.4;

    // Add caustics
    baseColor += CAUSTIC_COLOR * caustics * 0.2;

    // Apply multi-stage foam with different colors and blending
    vec3 finalColor = baseColor;

    // Apply base foam (most subtle)
    finalColor = mix(finalColor, FOAM_DECAY, baseFoam * 0.4);

    // Apply residual foam (medium intensity)
    finalColor = mix(finalColor, FOAM_MATURE, residualFoam * 0.7);

    // Apply active breaking foam (most intense, pure white)
    finalColor = mix(finalColor, FOAM_NASCENT, activeFoam);

    // Ensure only the most active breaking shows pure white
    baseColor = finalColor;

    // Add specular highlights with Fresnel modulation
    vec3 reflectDir = reflect(-sunDir, normal);
    float specular = pow(max(0.0, dot(viewDir, reflectDir)), 64.0);
    baseColor += vec3(specular * fresnel * 0.6);

    // Add shimmer from surface ripples
    vec3 rippleNormal = texture(u_rippleTexture, v_uv).rgb * 2.0 - 1.0;
    float shimmer = pow(max(0.0, dot(rippleNormal, sunDir)), 16.0);
    baseColor += vec3(shimmer * 0.2);

    // Stylistic quantization
    baseColor = quantizeColor(baseColor, 12);

    // Add subtle noise for texture
    vec2 noisePos = gl_FragCoord.xy * 0.5;
    float dither = hash21(noisePos + v_time) * 0.02 - 0.01;
    baseColor += vec3(dither);

    // Atmospheric perspective (distance fog)
    float distance = length(oceanPos) / 30.0;
    float fog = 1.0 - exp(-distance * 0.1);
    vec3 fogColor = vec3(0.7, 0.8, 0.9);
    baseColor = mix(baseColor, fogColor, fog * 0.2);

    fragColor = vec4(baseColor, 1.0);
}