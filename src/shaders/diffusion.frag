#version 300 es

precision highp float;

in vec2 v_uv;

uniform sampler2D u_sourceTexture;
uniform float u_viscosity;
uniform float u_deltaTime;
uniform vec2 u_texelSize;

out vec4 fragColor;

void main() {
    vec2 coord = v_uv;

    // Sample center and neighbors
    vec4 center = texture(u_sourceTexture, coord);
    vec4 left   = texture(u_sourceTexture, coord - vec2(u_texelSize.x, 0.0));
    vec4 right  = texture(u_sourceTexture, coord + vec2(u_texelSize.x, 0.0));
    vec4 bottom = texture(u_sourceTexture, coord - vec2(0.0, u_texelSize.y));
    vec4 top    = texture(u_sourceTexture, coord + vec2(0.0, u_texelSize.y));

    // Discrete Laplacian operator
    vec4 laplacian = left + right + bottom + top - 4.0 * center;

    // Diffusion equation: ∂u/∂t = ν∇²u
    float alpha = u_viscosity * u_deltaTime / (u_texelSize.x * u_texelSize.x);
    fragColor = center + alpha * laplacian;
}