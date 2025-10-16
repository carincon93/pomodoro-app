import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import * as NavigationBar from "expo-navigation-bar";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { Platform } from "react-native";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    const setupNavigationBar = async () => {
      if (Platform.OS === "android") {
        // Set the navigation bar style
        await NavigationBar.setStyle("dark");
        // Hide navigation bar and enable swipe to show
        await NavigationBar.setBehaviorAsync("overlay-swipe");
        await NavigationBar.setVisibilityAsync("hidden");
      }
    };

    setupNavigationBar();
  }, []);

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}></Stack>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
