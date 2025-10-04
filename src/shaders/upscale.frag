#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;

uniform sampler2D u_sourceTexture;    // Low-resolution source texture
uniform vec2 u_sourceResolution;      // Source texture resolution
uniform vec2 u_targetResolution;      // Target output resolution
uniform float u_sharpness;            // Sharpening strength (0.0-1.0)
uniform int u_upscaleMethod;          // 0=bilinear, 1=bicubic, 2=fsr, 3=lanczos

out vec4 fragColor;

// ===== UPSCALING METHODS =====

/**
 * Bilinear upscaling (hardware-accelerated, fastest)
 */
vec3 bilinearUpscale(vec2 uv) {
    return texture(u_sourceTexture, uv).rgb;
}

/**
 * Bicubic upscaling (higher quality than bilinear)
 * Uses 4x4 sample grid with cubic interpolation
 */
vec3 bicubicUpscale(vec2 uv) {
    vec2 texelSize = 1.0 / u_sourceResolution;
    vec2 coord = uv * u_sourceResolution - 0.5;
    vec2 f = fract(coord);
    coord = floor(coord);

    // Cubic interpolation weights
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);

    // Sample 4x4 grid
    vec3 color = vec3(0.0);
    for (int y = -1; y <= 2; y++) {
        for (int x = -1; x <= 2; x++) {
            vec2 offset = vec2(float(x), float(y));
            vec2 sampleUV = (coord + offset + 0.5) * texelSize;

            float wx = (x == -1) ? w0.x : (x == 0) ? w1.x : (x == 1) ? w2.x : w3.x;
            float wy = (y == -1) ? w0.y : (y == 0) ? w1.y : (y == 1) ? w2.y : w3.y;

            color += texture(u_sourceTexture, sampleUV).rgb * wx * wy;
        }
    }

    return color;
}

/**
 * Lanczos upscaling (best for preserving wave details)
 * 3-tap Lanczos with sinc interpolation
 */
float lanczosWeight(float x, float a) {
    if (abs(x) < 0.001) return 1.0;
    if (abs(x) >= a) return 0.0;

    float pi_x = 3.14159265359 * x;
    return a * sin(pi_x) * sin(pi_x / a) / (pi_x * pi_x);
}

vec3 lanczosUpscale(vec2 uv) {
    vec2 texelSize = 1.0 / u_sourceResolution;
    vec2 coord = uv * u_sourceResolution;
    vec2 f = fract(coord);
    coord = floor(coord);

    const float a = 3.0; // Lanczos kernel size
    vec3 color = vec3(0.0);
    float weightSum = 0.0;

    for (float y = -2.0; y <= 2.0; y += 1.0) {
        for (float x = -2.0; x <= 2.0; x += 1.0) {
            vec2 offset = vec2(x, y);
            vec2 sampleUV = (coord + offset + 0.5) * texelSize;

            float wx = lanczosWeight(f.x - x, a);
            float wy = lanczosWeight(f.y - y, a);
            float weight = wx * wy;

            color += texture(u_sourceTexture, sampleUV).rgb * weight;
            weightSum += weight;
        }
    }

    return color / weightSum;
}

/**
 * FSR-inspired edge-adaptive upscaling with RCAS (Robust Contrast Adaptive Sharpening)
 * Detects edges and applies adaptive sharpening
 */
vec3 fsrUpscale(vec2 uv) {
    vec2 texelSize = 1.0 / u_sourceResolution;

    // Sample center and 4-neighbors (edge-aware sampling)
    vec3 center = texture(u_sourceTexture, uv).rgb;
    vec3 top = texture(u_sourceTexture, uv + vec2(0.0, texelSize.y)).rgb;
    vec3 bottom = texture(u_sourceTexture, uv - vec2(0.0, texelSize.y)).rgb;
    vec3 left = texture(u_sourceTexture, uv - vec2(texelSize.x, 0.0)).rgb;
    vec3 right = texture(u_sourceTexture, uv + vec2(texelSize.x, 0.0)).rgb;

    // Calculate edge strength (gradient magnitude)
    vec3 gradX = right - left;
    vec3 gradY = top - bottom;
    float edgeStrength = length(gradX) + length(gradY);

    // Edge-adaptive bicubic interpolation
    vec3 baseColor = bicubicUpscale(uv);

    // RCAS sharpening (Robust Contrast Adaptive Sharpening)
    // Calculate local contrast
    vec3 minColor = min(min(min(top, bottom), left), right);
    vec3 maxColor = max(max(max(top, bottom), left), right);

    // Adaptive sharpening strength based on local contrast
    vec3 localContrast = maxColor - minColor;
    float contrastFactor = length(localContrast);

    // Sharpening kernel (5-tap filter)
    vec3 sharpened = center * (1.0 + 4.0 * u_sharpness * contrastFactor)
                    - (top + bottom + left + right) * (u_sharpness * contrastFactor * 0.25);

    // Clamp to prevent oversharpening artifacts
    sharpened = clamp(sharpened, minColor, maxColor);

    // Blend based on edge strength (sharpen edges more, smooth areas less)
    float edgeBlend = smoothstep(0.0, 0.3, edgeStrength);
    return mix(baseColor, sharpened, edgeBlend);
}

// ===== MAIN UPSCALING FUNCTION =====

void main() {
    vec3 color;

    // Select upscaling method
    if (u_upscaleMethod == 0) {
        // Bilinear (fastest)
        color = bilinearUpscale(v_uv);
    } else if (u_upscaleMethod == 1) {
        // Bicubic (higher quality)
        color = bicubicUpscale(v_uv);
    } else if (u_upscaleMethod == 2) {
        // FSR-inspired (edge-adaptive with sharpening)
        color = fsrUpscale(v_uv);
    } else {
        // Lanczos (best for wave details)
        color = lanczosUpscale(v_uv);
    }

    // Optional post-sharpening for non-FSR methods
    if (u_upscaleMethod != 2 && u_sharpness > 0.0) {
        vec2 texelSize = 1.0 / u_sourceResolution;

        // Simple unsharp mask
        vec3 center = color;
        vec3 top = texture(u_sourceTexture, v_uv + vec2(0.0, texelSize.y)).rgb;
        vec3 bottom = texture(u_sourceTexture, v_uv - vec2(0.0, texelSize.y)).rgb;
        vec3 left = texture(u_sourceTexture, v_uv - vec2(texelSize.x, 0.0)).rgb;
        vec3 right = texture(u_sourceTexture, v_uv + vec2(texelSize.x, 0.0)).rgb;

        vec3 laplacian = center * 5.0 - (top + bottom + left + right);
        color = center + laplacian * u_sharpness * 0.3;
    }

    // Output final color
    fragColor = vec4(color, 1.0);
}
