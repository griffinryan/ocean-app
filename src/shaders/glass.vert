#version 300 es

precision highp float;

in vec3 a_position;
in vec2 a_texcoord;

uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform float u_time;

out vec2 v_uv;
out vec2 v_screenPos;
out float v_time;

void main() {
    // Pass through UV coordinates
    v_uv = a_texcoord;

    // Pass through time for animation
    v_time = u_time;

    // For screen-space rendering, use position directly
    // Use only x,y from position, ignore z
    gl_Position = vec4(a_position.xy, 0.0, 1.0);

    // Pass screen position for distortion calculations
    v_screenPos = a_position.xy;
}