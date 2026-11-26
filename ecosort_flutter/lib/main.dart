import 'package:material_ui/material_ui.dart';

import 'screens/home_screen.dart';
import 'services/ecosort_controller.dart';
import 'theme.dart';
import 'widgets/mobile_frame.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(EcoSortApp(controller: EcoSortController()));
}

/// Root widget. The controller is injected so tests can supply an in-memory
/// store and never touch `shared_preferences` or the network.
class EcoSortApp extends StatelessWidget {
  const EcoSortApp({super.key, required this.controller});

  final EcoSortController controller;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EcoSort',
      debugShowCheckedModeBanner: false,
      theme: buildEcoSortTheme(),
      // Desktop/tablet browsers get a centred 430 px phone frame; narrow
      // mobile viewports stay full-bleed.
      builder: (BuildContext context, Widget? child) =>
          MobileFrame(child: child ?? const SizedBox.shrink()),
      home: HomeScreen(controller: controller),
    );
  }
}
