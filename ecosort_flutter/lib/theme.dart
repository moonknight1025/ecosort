import 'package:material_ui/material_ui.dart';

/// EcoSort's visual language: a green seed colour, Material 3 surfaces, and
/// generous rounding to match the mobile card layout.
///
/// Deliberately does not set `cardTheme`: its type changed between Flutter
/// releases (`CardTheme` → `CardThemeData`), and the app runs on whatever SDK
/// the developer has. Cards are styled locally where it matters.
ThemeData buildEcoSortTheme() {
  final ColorScheme scheme = ColorScheme.fromSeed(
    seedColor: const Color(0xFF2E7D32),
    brightness: Brightness.light,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: const Color(0xFFF4F7F4),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        // NOT Size.fromHeight(48): that is an infinite *minimum width*,
        // which throws inside any unbounded-width parent (e.g. a Row).
        minimumSize: const Size(0, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}
