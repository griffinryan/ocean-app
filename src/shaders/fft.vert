#version 300 es

in vec3 a_position;
in vec2 a_texcoord;

out vec2 v_uv;
out vec2 v_position;

void main() {
    v_uv = a_texcoord;
    v_position = a_position.xy;
    gl_Position = vec4(a_position.xy, 0.0, 1.0);
}