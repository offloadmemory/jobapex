// This package is `"type": "module"`, so the postcss config must be ESM.
// (The brief showed a CJS module.exports form; vite/postcss-load-config accept either.)
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};