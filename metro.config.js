// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// 🔧 Forzar rutas absolutas reales (sin [metro-project])
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: false,
    },
  }),
};

config.resolver.assetExts = config.resolver.assetExts || [];
config.projectRoot = path.resolve(projectRoot); // 🔥 Clave para VSCode
config.watchFolders = [config.projectRoot];

module.exports = config;
