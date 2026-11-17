# Raspberry Pi kiosk setup

These steps put the scorecard full screen on the TV and make it come back by itself after a reboot, a power cut, or a Wi-Fi drop.

**Dashboard URL:** https://colbylimb.github.io/NambeLA-KPI/

These steps are written for **Raspberry Pi OS with desktop** (Bookworm or newer), connected to the TV over HDMI, with a keyboard plugged in for setup.

## 1. Basic settings (one time)

Open a terminal and run:

```bash
sudo raspi-config
```

Change these settings:

| Menu | Setting | Why |
|---|---|---|
| **System Options → Boot / Auto Login** | *Desktop Autologin* | The Pi boots straight to the desktop with no password prompt. |
| **Display Options → Screen Blanking** | *No* | The Pi never turns the screen off. The page has its own after-hours screensaver. |
| **Localisation Options → Timezone** | *America → Denver* | **Important.** The 8 AM / 7 PM schedule and the clock use the Pi's time zone. |
| **Advanced Options → Wayland** | *labwc* | This is the desktop the autostart step below expects. |
| **Interface Options → SSH** | *Enable* (optional) | Lets you manage the Pi from another computer later without unplugging the TV. |

Choose **Finish** and let it reboot.

## 2. Install the launcher

```bash
curl -fsSL https://colbylimb.github.io/NambeLA-KPI/kiosk/kiosk.sh -o ~/kiosk.sh
```

```bash
chmod +x ~/kiosk.sh
```

The launcher:
- waits for the internet before opening the page,
- opens Chromium full screen in kiosk mode,
- reopens Chromium within 5 seconds if it ever closes or crashes,
- hides the "didn't shut down correctly" bar after a power cut.

## 3. Start it automatically on boot

```bash
mkdir -p ~/.config/labwc && echo '~/kiosk.sh &' >> ~/.config/labwc/autostart
```

Reboot:

```bash
sudo reboot
```

The Pi should boot straight into the scorecard.

## 4. Check it

- **During the day (8 AM–7 PM):** the dashboard shows. The mouse cursor is hidden.
- **After hours:** the branded screensaver shows the logo and clock. It drifts slightly every minute so nothing burns into the TV.
- **The header pill** is green when the data is current.

To check either view on any computer:
- add `?mode=screensaver` to the URL to force the screensaver,
- add `?mode=dashboard` to force the dashboard.

## What happens on its own

| Situation | What the screen does |
|---|---|
| New data at midnight | The page re-reads the numbers every 10 minutes, so no reload is needed. |
| Design changes pushed to GitHub | The page reloads itself at 3 AM, but only if the site is reachable. |
| Wi-Fi drops during the day | The last numbers stay on screen and the header pill turns red until the connection is back. |
| Power cut | The Pi boots, waits for Wi-Fi, and opens the page. |
| Someone taps the screensaver | The dashboard shows for 2 minutes, then the screensaver comes back. |

## Changing or stopping it later

- **Change the hours:** edit `SHOW_FROM` / `SHOW_UNTIL` at the top of `assets/app.js` in GitHub. The TV picks up the change at 3 AM.
- **Get back to the desktop with a keyboard:** press `Ctrl+Alt+T` to open a terminal, then run `pkill -f kiosk.sh; pkill chromium`.
- **Over SSH:** run the same `pkill -f kiosk.sh; pkill chromium` command.
- **Turn the kiosk off for good:** delete the `~/kiosk.sh &` line from `~/.config/labwc/autostart`.

## Troubleshooting

- **Black screen or desktop, no browser:** run `~/kiosk.sh` in a terminal and read the error.
- **The schedule is off by hours:** the time zone isn't America/Denver. Redo step 1.
- **The picture looks soft or sluggish on a 4K TV:** open **Screen Configuration** from the Pi menu, set the resolution to 1920×1080, and click Apply. The dashboard is laid out for 1080p and scales either way.
- **Older Raspberry Pi OS (Bullseye / X11):** put `@/home/pi/kiosk.sh` (use your username) in `~/.config/lxsession/LXDE-pi/autostart` instead of step 3.
