#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_samplingUV;

uniform sampler2D u_oceanTexture;   // Ocean color texture
uniform sampler2D u_normalTexture;  // Ocean normal texture (optional)
uniform vec4 u_samplingBounds;      // Text element bounds
uniform vec2 u_resolution;
uniform float u_time;

out vec4 fragColor;

// Sample ocean texture with multiple points for better analysis
vec3 sampleOceanMultipoint(vec2 baseUV) {
    vec3 totalColor = vec3(0.0);
    float totalWeight = 0.0;

    // 3x3 sampling pattern with different weights
    // Center point gets highest weight, corners get lowest
    float weights[9] = float[9](
        0.5, 1.0, 0.5,
        1.0, 2.0, 1.0,
        0.5, 1.0, 0.5
    );

    vec2 texelSize = 1.0 / u_resolution;
    int index = 0;

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y)) * texelSize * 2.0;
            vec2 sampleUV = baseUV + offset;

            // Ensure we stay within bounds
            if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 &&
                sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {

                vec3 color = texture(u_oceanTexture, sampleUV).rgb;
                float weight = weights[index];

                totalColor += color * weight;
                totalWeight += weight;
            }
            index++;
        }
    }

    return totalWeight > 0.0 ? totalColor / totalWeight : vec3(0.0);
}

// Calculate relative luminance for contrast analysis
float getLuminance(vec3 color) {
    // sRGB to linear conversion (simplified)
    vec3 linearColor = pow(color, vec3(2.2));

    // ITU-R BT.709 luminance coefficients
    return dot(linearColor, vec3(0.2126, 0.7152, 0.0722));
}

// Analyze wave intensity from normal texture
float getWaveIntensity(vec2 uv) {
    if (textureSize(u_normalTexture, 0) == ivec2(1, 1)) {
        // Normal texture not available, estimate from color variation
        vec3 color = texture(u_oceanTexture, uv).rgb;

        // Use blue channel intensity and variation as wave proxy
        float blueIntensity = color.b;

        // Sample surrounding pixels for variation
        vec2 texelSize = 1.0 / u_resolution;
        float variation = 0.0;

        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                if (x == 0 && y == 0) continue;

                vec2 offset = vec2(float(x), float(y)) * texelSize;
                vec3 neighborColor = texture(u_oceanTexture, uv + offset).rgb;
                variation += abs(neighborColor.b - blueIntensity);
            }
        }

        return variation * 0.125; // Average of 8 samples
    } else {
        // Use actual normal texture
        vec3 normal = texture(u_normalTexture, uv).xyz * 2.0 - 1.0;

        // Wave intensity based on normal deviation from vertical
        float intensity = 1.0 - abs(normal.z);
        return clamp(intensity, 0.0, 1.0);
    }
}

// Detect foam/crest areas
float getFoamFactor(vec3 oceanColor) {
    // Foam typically appears as bright, desaturated areas
    float brightness = getLuminance(oceanColor);

    // Calculate saturation
    float maxChannel = max(max(oceanColor.r, oceanColor.g), oceanColor.b);
    float minChannel = min(min(oceanColor.r, oceanColor.g), oceanColor.b);
    float saturation = (maxChannel > 0.0) ? (maxChannel - minChannel) / maxChannel : 0.0;

    // Foam is bright and low saturation
    float foamFactor = brightness * (1.0 - saturation);

    // Also check for white-ish areas specifically
    vec3 whiteness = 1.0 - abs(oceanColor - vec3(1.0));
    float whitenessFactor = (whiteness.r + whiteness.g + whiteness.b) / 3.0;

    return max(foamFactor, whitenessFactor * 0.7);
}

// Detect crystalline glass areas (if glass panels are active)
float getGlassFactor(vec3 oceanColor) {
    // Glass areas typically have enhanced blue tint and crystalline patterns
    float blueness = oceanColor.b - (oceanColor.r + oceanColor.g) * 0.5;

    // Look for quantized/stepped color patterns typical of glass shader
    float quantization = 0.0;
    vec3 quantized = floor(oceanColor * 8.0 + 0.5) / 8.0;
    vec3 quantDiff = abs(oceanColor - quantized);
    quantization = 1.0 - length(quantDiff);

    return clamp(blueness + quantization * 0.3, 0.0, 1.0);
}

void main() {
    // Sample ocean at the current fragment position
    vec3 oceanColor = sampleOceanMultipoint(v_samplingUV);

    // Calculate luminance for contrast analysis
    float luminance = getLuminance(oceanColor);

    // Get wave intensity
    float waveIntensity = getWaveIntensity(v_samplingUV);

    // Detect foam areas
    float foamFactor = getFoamFactor(oceanColor);

    // Detect glass areas
    float glassFactor = getGlassFactor(oceanColor);

    // Encode analysis results in output channels:
    // R: Average luminance
    // G: Wave intensity + foam factor
    // B: Glass factor
    // A: Color variance (will be calculated by comparing neighboring samples)

    // Calculate local color variance by comparing with offset samples
    vec2 texelSize = 1.0 / u_resolution;
    float colorVariance = 0.0;

    vec3 centerColor = oceanColor;
    for (int i = 0; i < 4; i++) {
        vec2 offset = vec2(0.0);
        if (i == 0) offset = vec2(texelSize.x, 0.0);
        else if (i == 1) offset = vec2(-texelSize.x, 0.0);
        else if (i == 2) offset = vec2(0.0, texelSize.y);
        else if (i == 3) offset = vec2(0.0, -texelSize.y);

        vec3 neighborColor = texture(u_oceanTexture, v_samplingUV + offset).rgb;
        colorVariance += distance(centerColor, neighborColor);
    }
    colorVariance *= 0.25; // Average of 4 samples

    // Enhanced wave intensity combining multiple factors
    float enhancedWaveIntensity = waveIntensity + foamFactor * 0.5;
    enhancedWaveIntensity = clamp(enhancedWaveIntensity, 0.0, 1.0);

    // Output encoded analysis data
    fragColor = vec4(
        luminance,              // R: Background luminance
        enhancedWaveIntensity,  // G: Wave activity + foam
        glassFactor,            // B: Glass panel detection
        colorVariance           // A: Local color variation
    );
}