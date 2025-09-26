#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_position;

uniform sampler2D u_inputTexture;
uniform int u_stage;
uniform int u_direction; // 0 = horizontal, 1 = vertical
uniform float u_size;

out vec4 fragColor;

// Complex number operations
vec2 complexMul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 complexAdd(vec2 a, vec2 b) {
    return a + b;
}

vec2 complexSub(vec2 a, vec2 b) {
    return a - b;
}

// Bit reversal for given number of bits
int bitReverse(int n, int bits) {
    int reversed = 0;
    for (int i = 0; i < 16; i++) { // Max 16 bits for 65536x65536
        if (i >= bits) break;
        reversed = (reversed << 1) | (n & 1);
        n >>= 1;
    }
    return reversed;
}

void main() {
    vec2 coord = v_uv;
    int N = int(u_size);

    // Current pixel coordinates
    int x = int(coord.x * u_size);
    int y = int(coord.y * u_size);

    // Stockham FFT implementation
    int stage = u_stage;
    int blockSize = 1 << (stage + 1);
    int halfBlock = blockSize >> 1;

    vec2 inputSample;
    vec2 twiddleSample;

    if (u_direction == 0) { // Horizontal FFT
        // Calculate twiddle factor
        int k = x % halfBlock;
        float angle = -2.0 * 3.14159265359 * float(k) / float(blockSize);
        vec2 twiddle = vec2(cos(angle), sin(angle));

        // Calculate input indices
        int block = x / halfBlock;
        int indexA = (block / 2) * blockSize + (block % 2) * halfBlock + k;
        int indexB = indexA + halfBlock;

        // Sample input values
        vec2 coordA = vec2(float(indexA) / u_size, coord.y);
        vec2 coordB = vec2(float(indexB) / u_size, coord.y);

        vec2 sampleA = texture(u_inputTexture, coordA).rg;
        vec2 sampleB = texture(u_inputTexture, coordB).rg;

        // Butterfly operation
        vec2 product = complexMul(sampleB, twiddle);

        if ((x / halfBlock) % 2 == 0) {
            inputSample = complexAdd(sampleA, product);
        } else {
            inputSample = complexSub(sampleA, product);
        }
    } else { // Vertical FFT
        // Calculate twiddle factor
        int k = y % halfBlock;
        float angle = -2.0 * 3.14159265359 * float(k) / float(blockSize);
        vec2 twiddle = vec2(cos(angle), sin(angle));

        // Calculate input indices
        int block = y / halfBlock;
        int indexA = (block / 2) * blockSize + (block % 2) * halfBlock + k;
        int indexB = indexA + halfBlock;

        // Sample input values
        vec2 coordA = vec2(coord.x, float(indexA) / u_size);
        vec2 coordB = vec2(coord.x, float(indexB) / u_size);

        vec2 sampleA = texture(u_inputTexture, coordA).rg;
        vec2 sampleB = texture(u_inputTexture, coordB).rg;

        // Butterfly operation
        vec2 product = complexMul(sampleB, twiddle);

        if ((y / halfBlock) % 2 == 0) {
            inputSample = complexAdd(sampleA, product);
        } else {
            inputSample = complexSub(sampleA, product);
        }
    }

    fragColor = vec4(inputSample, 0.0, 1.0);
}