#version 300 es

precision highp float;

in vec2 a_position;
in vec2 a_uv;

uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform float u_time;

out vec2 v_uv;
out vec2 v_screenPos;
out float v_time;

void main() {
    // Pass through UV coordinates
    v_uv = a_uv;

    // Pass through time for animation
    v_time = u_time;

    // Calculate screen position
    vec4 worldPos = vec4(a_position, 0.0, 1.0);
    gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;

    // Pass screen position for distortion calculations
    v_screenPos = gl_Position.xy / gl_Position.w;
}