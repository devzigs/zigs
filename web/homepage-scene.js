// Decorative lighting only. The sole texture is the unchanged original hero zebra artwork.
const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * .5 + .5;
  gl_Position = vec4(a_position, 0., 1.);
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D u_art;
uniform float u_time;
uniform vec2 u_pointer;
varying vec2 v_uv;

float ellipse(vec2 p, vec2 center, vec2 radius) {
  vec2 q = (p - center) / radius;
  return exp(-dot(q, q) * 1.7);
}

// Broad anatomical fields, authored for this left-facing portrait. Fine digits never move.
vec3 portraitNormal(vec2 p) {
  vec2 head = (p - vec2(.47, .44)) / vec2(.36, .43);
  vec2 muzzle = (p - vec2(.20, .67)) / vec2(.21, .22);
  vec2 neck = (p - vec2(.68, .78)) / vec2(.35, .47);
  float nose = ellipse(p, vec2(.22, .65), vec2(.22, .25));
  float body = smoothstep(.52, .82, p.y) * smoothstep(.30, .57, p.x);
  vec3 normal = normalize(vec3(head.x * .68, -head.y * .42, 1.));
  normal = mix(normal, normalize(vec3(muzzle.x * .7, -muzzle.y * .4, .95)), nose);
  return normalize(mix(normal, normalize(vec3(neck.x * .85, -neck.y * .3, 1.)), body));
}

void main() {
  vec2 p = vec2(v_uv.x, 1. - v_uv.y);
  vec4 art = texture2D(u_art, p);
  if (art.a < .004) discard;
  float cycle = max(0., u_time - 1.5) * 6.283185 / 14.;
  vec3 normal = portraitNormal(p);
  vec3 light = normalize(vec3(.12 + sin(cycle) * .9 + u_pointer.x * .75,
    .72 + cos(cycle) * .24 - u_pointer.y * .55, 1.05));
  float diffuse = max(0., dot(normal, light));
  vec3 halfLight = normalize(light + vec3(0., 0., 1.));
  float reflection = pow(max(0., dot(normal, halfLight)), 24.);
  float crest = ellipse(p, vec2(.72, .28), vec2(.27, .39));
  float cheek = ellipse(p, vec2(.43, .53), vec2(.26, .30));
  float shoulder = ellipse(p, vec2(.69, .82), vec2(.30, .27));
  float arrival = clamp(u_time / 1.5, 0., 1.);
  float sweepAt = mix(.82, -.40, smoothstep(0., 1., arrival));
  float sweep = exp(-pow((dot(p, vec2(.8, -.6)) - sweepAt) / .20, 2.));
  sweep *= (1. - smoothstep(.78, 1., arrival)) * .48;
  float facing = .56 + diffuse * .29;
  float sheen = reflection * (.20 + crest * .16 + cheek * .12 + shoulder * .09);
  float grain = dot(art.rgb, vec3(.2126, .7152, .0722));
  vec3 silver = vec3(.88, .94, 1.);
  vec3 copper = vec3(1., .77, .57);
  float warm = clamp(crest * .56 + shoulder * .22 + .12 * sin(cycle), 0., .65);
  vec3 illumination = mix(silver, copper, warm);
  vec3 color = art.rgb * facing + illumination * (sheen + sweep) * grain;
  // The original red eye is an unlit identity detail, never a pulsing status light.
  float red = smoothstep(.07, .20, art.r - max(art.g, art.b));
  color = mix(color, art.rgb, red);
  gl_FragColor = vec4(clamp(color, 0., 1.) * art.a, art.a);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Homepage lighting unavailable");
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  throw new Error("Homepage lighting unavailable");
}

function pipeline(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  let fragment, program;
  try {
    fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram();
    if (!program) throw new Error("Homepage lighting unavailable");
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Homepage lighting unavailable");
    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}

function upload(gl, image) {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Homepage lighting unavailable");
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return texture;
  } catch (error) { gl.deleteTexture(texture); throw error; }
}

export function sceneSample(milliseconds, pointer = { x: 0, y: 0 }) {
  const elapsed = Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 1500);
  const seconds = (elapsed < 1500 ? elapsed : 1500 + (elapsed - 1500) % 14000) / 1000;
  const bound = (value) => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return { seconds, x: bound(pointer.x), y: bound(pointer.y),
    atmosphere: .60 + Math.sin(Math.max(0, seconds - 1.5) * Math.PI * 2 / 14) * .14 };
}

/** One transparent quad; no framework, model, derived identity or external resource. */
export function createHeroScene(image, doc = image.ownerDocument) {
  const canvas = doc.createElement("canvas");
  canvas.className = "home-hero-lighting"; canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false,
    stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false,
    powerPreference: "low-power", failIfMajorPerformanceCaveat: true });
  if (!gl) throw new Error("Homepage lighting unavailable");
  let program, texture, buffer;
  try {
    program = pipeline(gl); texture = upload(gl, image); buffer = gl.createBuffer();
    if (!buffer) throw new Error("Homepage lighting unavailable");
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),
      gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(program, "u_art"), 0);
  } catch (error) {
    if (program) gl.deleteProgram(program);
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    throw error;
  }
  const time = gl.getUniformLocation(program, "u_time");
  const pointer = gl.getUniformLocation(program, "u_pointer");
  let disposed = false;
  return { canvas,
    resize(width, pixelRatio = 1) {
      const size = Math.min(1024, Math.max(1, Math.round(width * Math.min(1.5, pixelRatio))));
      if (canvas.width === size && canvas.height === size) return;
      canvas.width = size; canvas.height = size; gl.viewport(0, 0, size, size);
    },
    draw(sample) {
      if (disposed || gl.isContextLost()) throw new Error("Homepage lighting unavailable");
      gl.uniform1f(time, sample.seconds); gl.uniform2f(pointer, sample.x, sample.y);
      gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } };
}
