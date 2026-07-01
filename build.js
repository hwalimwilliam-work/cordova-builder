const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────
// 1. Load & Validate config.json
// ─────────────────────────────────────────────

const configPath = path.join(__dirname, 'config.json');

if (!fs.existsSync(configPath)) {
  console.error('\n[ERROR] config.json not found. Aborting.\n');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const { appName, packageId, targetUrl, versionName, versionCode, icon } = config;

const requiredFields = ['appName', 'packageId', 'targetUrl', 'versionName', 'versionCode'];
for (const field of requiredFields) {
  if (!config[field] && config[field] !== 0) {
    console.error(`\n[ERROR] Missing required field "${field}" in config.json. Aborting.\n`);
    process.exit(1);
  }
}

// Validate URL format
try {
  new URL(targetUrl);
} catch {
  console.error(`\n[ERROR] targetUrl "${targetUrl}" is not a valid URL. Aborting.\n`);
  process.exit(1);
}

// ─────────────────────────────────────────────
// 2. Paths
// ─────────────────────────────────────────────

const projectsDir = path.join(__dirname, 'projects');
const projectDir  = path.join(projectsDir, packageId);
const distDir     = path.join(__dirname, 'dist');

// ─────────────────────────────────────────────
// 3. Helper: run shell command
// ─────────────────────────────────────────────

function run(cmd, cwd = __dirname) {
  console.log(`\n  > ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit', shell: true });
  } catch (err) {
    console.error(`\n[ERROR] Command failed: ${cmd}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// 4. Print build summary
// ─────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════╗');
console.log('║       Cordova WebView APK Builder        ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`\n  App Name   : ${appName}`);
console.log(`  Package ID : ${packageId}`);
console.log(`  Target URL : ${targetUrl}`);
console.log(`  Version    : ${versionName} (code: ${versionCode})`);
console.log(`  Icon       : ${icon || 'none (using Cordova default)'}`);
console.log('');

// ─────────────────────────────────────────────
// 5. Clean previous project
// ─────────────────────────────────────────────

if (fs.existsSync(projectDir)) {
  console.log(`\n[STEP 1/7] Removing existing project folder...`);
  fs.rmSync(projectDir, { recursive: true, force: true });
  console.log('  Done.');
} else {
  console.log(`\n[STEP 1/7] No existing project found. Skipping clean.`);
}

if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
}

// ─────────────────────────────────────────────
// 6. Create Cordova project
// ─────────────────────────────────────────────

console.log(`\n[STEP 2/7] Creating Cordova project...`);
run(`cordova create "${projectDir}" "${packageId}" "${appName}"`);

// ─────────────────────────────────────────────
// 7. Add Android platform
// ─────────────────────────────────────────────

console.log(`\n[STEP 3/7] Adding Android platform...`);
run('cordova platform add android', projectDir);

// ─────────────────────────────────────────────
// 8. Modify config.xml
// ─────────────────────────────────────────────

console.log(`\n[STEP 4/7] Configuring config.xml...`);

const configXmlPath = path.join(projectDir, 'config.xml');
let configXml = fs.readFileSync(configXmlPath, 'utf8');

// Update version
configXml = configXml.replace(
  /(<widget[^>]*)\bversion="[^"]*"/,
  `$1version="${versionName}"`
);

// Update content src → load external URL directly
configXml = configXml.replace(
  /<content\s+src="[^"]*"\s*\/>/,
  `<content src="${targetUrl}" />`
);

// Remove default allow-intent tags (we replace with full config below)
configXml = configXml.replace(/<allow-intent[^\/]*\/>\s*/g, '');

// Build Android platform block
const iconRelPath       = 'res/icon.png';        // launcher icon (copied in step 5)
const splashIconRelPath = 'res/splash_icon.png'; // Android 12+ splash icon (copied in step 5)

// Splash / fullscreen theming (dark to match a typical dark web UI; adjust if needed)
const splashBackground   = '#000000';   // Android 12+ system splash background
const backgroundColorArgb = '0xFF000000'; // WebView/app background (ARGB) — prevents white flashes

const androidBlock = `
    <!-- Network Access Rules -->
    <access origin="*" />
    <allow-navigation href="*" />
    <allow-intent href="http://*/*" />
    <allow-intent href="https://*/*" />
    <allow-intent href="tel:*" />
    <allow-intent href="sms:*" />
    <allow-intent href="mailto:*" />

    <!-- Android Platform Config -->
    <platform name="android">
        <preference name="android-minSdkVersion"    value="24" />
        <preference name="android-targetSdkVersion" value="34" />
        <preference name="AndroidLaunchMode"         value="singleTask" />
        <preference name="MixedContentMode"          value="0" />
        <preference name="AllowInlineMediaPlayback"  value="true" />
        <preference name="MediaPlaybackRequiresUserAction" value="false" />
        <preference name="DisallowOverscroll"        value="true" />
        <preference name="LoadUrlTimeoutValue"       value="30000" />

        <!-- Immersive fullscreen: hides BOTH status bar and navigation bar.
             Applied natively by CordovaActivity on every window-focus change,
             so it persists after navigating to the external Target URL. -->
        <preference name="Fullscreen"                value="true" />

        <!-- App/WebView background: eliminates white flashes between splash,
             local index.html, and the remote page load. -->
        <preference name="BackgroundColor"           value="${backgroundColorArgb}" />

        <!-- Android 12+ system splash screen (replaces the default Cordova icon). -->
        <preference name="AndroidWindowSplashScreenBackground"          value="${splashBackground}" />
        <preference name="AndroidWindowSplashScreenIconBackgroundColor" value="${splashBackground}" />
        <preference name="AndroidWindowSplashScreenAnimatedIcon"        value="${splashIconRelPath}" />
        <preference name="AndroidWindowSplashScreenAnimationDuration"   value="200" />

        ${icon ? `<icon src="${iconRelPath}" />` : ''}
    </platform>
`;

configXml = configXml.replace('</widget>', `${androidBlock}\n</widget>`);

fs.writeFileSync(configXmlPath, configXml, 'utf8');
console.log('  config.xml updated.');

// ─────────────────────────────────────────────
// 9. Copy icon into project
// ─────────────────────────────────────────────

console.log(`\n[STEP 5/7] Processing icon...`);

if (icon) {
  const iconSrc = path.resolve(__dirname, icon);
  if (fs.existsSync(iconSrc)) {
    const iconDestDir = path.join(projectDir, 'res');
    if (!fs.existsSync(iconDestDir)) fs.mkdirSync(iconDestDir, { recursive: true });
    fs.copyFileSync(iconSrc, path.join(iconDestDir, 'icon.png'));
    console.log('  Icon copied to project.');
  } else {
    console.warn(`  [WARNING] Icon not found at: ${iconSrc}`);
    console.warn('  Proceeding without custom icon (Cordova default will be used).');
  }
} else {
  console.log('  No icon specified. Using Cordova default.');
}

// Splash icon: prefer a purpose-built res/splash_icon.png (safe-zone padded so the
// Android 12+ circular mask does not clip it). If absent, fall back to the launcher
// icon so the build still replaces Cordova's default gray icon.
const splashDestDir = path.join(projectDir, 'res');
if (!fs.existsSync(splashDestDir)) fs.mkdirSync(splashDestDir, { recursive: true });

const dedicatedSplash = path.resolve(__dirname, 'res/splash_icon.png');
const fallbackSplash  = icon ? path.resolve(__dirname, icon) : null;
const splashSrc = fs.existsSync(dedicatedSplash)
  ? dedicatedSplash
  : (fallbackSplash && fs.existsSync(fallbackSplash) ? fallbackSplash : null);

if (splashSrc) {
  fs.copyFileSync(splashSrc, path.join(splashDestDir, 'splash_icon.png'));
  console.log(`  Splash icon copied to project (source: ${path.basename(splashSrc)}).`);
} else {
  console.warn('  [WARNING] No splash icon source found. Cordova default splash icon will be used.');
}

// ─────────────────────────────────────────────
// 10. Write www/index.html (JS redirect fallback)
// ─────────────────────────────────────────────

// This acts as a fallback in case <content src> fails.
// Also loads cordova.js for back-button handling.
const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <title>${appName}</title>
  <style>
    * { margin: 0; padding: 0; }
    body { background: #000; }
  </style>
</head>
<body>
  <script src="cordova.js"></script>
  <script>
    // Back button: navigate WebView history or exit app
    document.addEventListener('deviceready', function () {
      document.addEventListener('backbutton', function (e) {
        e.preventDefault();
        if (history.length > 1) {
          history.back();
        } else {
          if (navigator.app && navigator.app.exitApp) {
            navigator.app.exitApp();
          }
        }
      }, false);
    }, false);

    // Redirect fallback if <content src> does not load external URL
    window.location.replace("${targetUrl}");
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(projectDir, 'www', 'index.html'), indexHtml, 'utf8');
console.log('  www/index.html written.');

// ─────────────────────────────────────────────
// 11. Build APK
// ─────────────────────────────────────────────

console.log(`\n[STEP 6/7] Building APK (debug)...`);
console.log('  This may take 2–5 minutes on first run (Gradle downloads dependencies).\n');
run('cordova build android', projectDir);

// ─────────────────────────────────────────────
// 12. Copy APK to dist/
// ─────────────────────────────────────────────

console.log(`\n[STEP 7/7] Copying APK to dist/ folder...`);

const apkSrc = path.join(
  projectDir,
  'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'
);

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

const safeAppName = appName.replace(/[^a-zA-Z0-9_\-]/g, '_');
const apkFileName = `${safeAppName}-v${versionName}-debug.apk`;
const apkDest     = path.join(distDir, apkFileName);

if (fs.existsSync(apkSrc)) {
  fs.copyFileSync(apkSrc, apkDest);

  const apkSizeKb = Math.round(fs.statSync(apkDest).size / 1024);

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║              BUILD SUCCESSFUL            ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\n  APK : dist/${apkFileName}`);
  console.log(`  Size: ${apkSizeKb} KB\n`);
} else {
  console.error('\n[ERROR] APK file not found after build. Check Gradle output above.');
  process.exit(1);
}
