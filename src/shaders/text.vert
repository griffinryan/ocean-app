#version 300 es

precision highp float;

// Vertex attributes
in vec2 a_position;    // Local text position
in vec2 a_texCoord;    // Font atlas UV coordinates

// Uniforms for transformation
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform vec2 u_textPosition;       // Text origin in screen space
uniform vec2 u_textScale;          // Text scale factor
uniform float u_time;              // Time for subtle animations
uniform vec2 u_resolution;         // Screen resolution
uniform float u_aspectRatio;       // Canvas aspect ratio

// Output to fragment shader
out vec2 v_texCoord;              // Font texture coordinates
out vec2 v_screenPos;             // Screen position for ocean sampling
out vec2 v_localPos;              // Local position within text bounds
out float v_time;                 // Time for animations

void main() {
    // Pass through texture coordinates
    v_texCoord = a_texCoord;
    v_time = u_time;

    // Scale the text position
    vec2 scaledPos = a_position * u_textScale;

    // Apply text positioning in screen space (pixel coordinates)
    vec2 screenPos = u_textPosition + scaledPos;

    // Convert directly from pixel coordinates to normalized device coordinates
    vec2 normalizedPos = vec2(
        (screenPos.x / u_resolution.x) * 2.0 - 1.0,
        1.0 - (screenPos.y / u_resolution.y) * 2.0
    );

    // Apply subtle wave-based animation to text
    float waveOffset = sin(normalizedPos.x * 8.0 + u_time * 2.0) * 0.002;
    normalizedPos.y += waveOffset;

    // Set final position
    gl_Position = vec4(normalizedPos, 0.0, 1.0);

    // Pass screen position for ocean color sampling
    v_screenPos = normalizedPos;

    // Pass local position for effects
    v_localPos = scaledPos;
}