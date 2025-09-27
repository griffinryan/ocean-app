#version 300 es

precision highp float;

// Input attributes
in vec3 a_position;
in vec2 a_texcoord;

// Output to fragment shader
out vec2 v_uv;
out vec2 v_screenPos;
out float v_time;

// Uniforms
uniform float u_time;

void main() {
    // Pass through UV coordinates
    v_uv = a_texcoord;

    // Convert position to screen coordinates
    v_screenPos = a_position.xy;

    // Pass time for animation
    v_time = u_time;

    // Output vertex position
    gl_Position = vec4(a_position.xy, 0.0, 1.0);
}