#version 300 es

precision highp float;

in vec2 a_position;
in vec2 a_uv;

uniform vec4 u_samplingBounds; // x, y, width, height in normalized coords
uniform vec2 u_resolution;

out vec2 v_uv;
out vec2 v_samplingUV;

void main() {
    // Pass through UV coordinates
    v_uv = a_uv;

    // Calculate sampling UV based on text element bounds
    // Convert from screen quad UV (0-1) to text element area
    vec2 textAreaUV = v_uv * u_samplingBounds.zw + u_samplingBounds.xy;

    // Clamp to valid range
    v_samplingUV = clamp(textAreaUV, vec2(0.0), vec2(1.0));

    // Standard full-screen quad position
    gl_Position = vec4(a_position, 0.0, 1.0);
}