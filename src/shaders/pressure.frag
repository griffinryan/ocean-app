#version 300 es

precision highp float;

in vec2 v_uv;

uniform sampler2D u_divergenceTexture;
uniform sampler2D u_pressureTexture;
uniform vec2 u_texelSize;

out vec4 fragColor;

void main() {
    vec2 coord = v_uv;

    // Sample pressure at neighbors
    float left   = texture(u_pressureTexture, coord - vec2(u_texelSize.x, 0.0)).r;
    float right  = texture(u_pressureTexture, coord + vec2(u_texelSize.x, 0.0)).r;
    float bottom = texture(u_pressureTexture, coord - vec2(0.0, u_texelSize.y)).r;
    float top    = texture(u_pressureTexture, coord + vec2(0.0, u_texelSize.y)).r;

    // Sample divergence at center
    float divergence = texture(u_divergenceTexture, coord).r;

    // Jacobi iteration for Poisson equation: ∇²p = ∇·v
    // p_new = (p_left + p_right + p_bottom + p_top - divergence) / 4
    float pressure = (left + right + bottom + top - divergence) * 0.25;

    fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}