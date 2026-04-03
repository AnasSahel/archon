import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextConfig = require("eslint-config-next");

export default Array.isArray(nextConfig) ? nextConfig : [nextConfig];
