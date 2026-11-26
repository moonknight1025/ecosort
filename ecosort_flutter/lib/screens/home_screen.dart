import 'package:material_ui/material_ui.dart';

import '../services/ecosort_controller.dart';
import '../services/ecosort_repository.dart';
import '../widgets/profile_bar.dart';
import 'badges_tab.dart';
import 'rank_tab.dart';
import 'scan_tab.dart';

/// The app shell: branded app bar with a live Eco Points pill, the profile
/// switcher, three tabs, and the data-mode switch.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller});

  final EcoSortController controller;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tabIndex = 0;

  @override
  void initState() {
    super.initState();
    widget.controller.initialise();
  }

  void _snack(String? message) {
    if (!mounted || message == null || message.isEmpty) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final EcoSortController controller = widget.controller;

    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? _) {
        final int points = controller.snapshot?.user.ecoPoints ?? 0;
        return Scaffold(
          appBar: AppBar(
            titleSpacing: 16,
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                const Text(
                  'EcoSort',
                  style: TextStyle(fontWeight: FontWeight.w800),
                ),
                Text(
                  'Make every piece of waste count!',
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
            actions: <Widget>[
              Center(
                child: Container(
                  key: const ValueKey<String>('eco-points'),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '🌟 $points pts',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),
              PopupMenuButton<DataMode>(
                tooltip: 'Data source',
                icon: const Icon(Icons.settings_ethernet),
                initialValue: controller.mode,
                onSelected: (DataMode mode) async {
                  await controller.setMode(mode);
                  if (!mounted) {
                    return;
                  }
                  _snack(controller.notice ?? controller.error);
                },
                itemBuilder: (BuildContext context) => <PopupMenuEntry<DataMode>>[
                  const PopupMenuItem<DataMode>(
                    value: DataMode.local,
                    child: Text('Local / mock mode'),
                  ),
                  const PopupMenuItem<DataMode>(
                    value: DataMode.api,
                    child: Text('Flask backend (127.0.0.1:5000)'),
                  ),
                ],
              ),
            ],
          ),
          body: Column(
            children: <Widget>[
              if (controller.mode == DataMode.api) _ModeBanner(busy: controller.busy),
              if (controller.busy) const LinearProgressIndicator(minHeight: 2),
              ProfileBar(
                initialUsername: controller.username,
                initialGroup: controller.groupName,
                initialCity: controller.city,
                busy: controller.busy,
                onSubmit: (String username, String group, String city) async {
                  await controller.setProfile(
                    username: username,
                    groupName: group,
                    city: city,
                  );
                  if (!mounted) {
                    return;
                  }
                  _snack(controller.error ?? 'Profile set: ${controller.username}');
                },
              ),
              Expanded(child: _bodyFor(controller)),
            ],
          ),
          bottomNavigationBar: NavigationBar(
            selectedIndex: _tabIndex,
            onDestinationSelected: (int index) =>
                setState(() => _tabIndex = index),
            destinations: const <NavigationDestination>[
              NavigationDestination(
                icon: Icon(Icons.qr_code_scanner_outlined),
                selectedIcon: Icon(Icons.qr_code_scanner),
                label: 'Scan',
              ),
              NavigationDestination(
                icon: Icon(Icons.emoji_events_outlined),
                selectedIcon: Icon(Icons.emoji_events),
                label: 'Badges',
              ),
              NavigationDestination(
                icon: Icon(Icons.leaderboard_outlined),
                selectedIcon: Icon(Icons.leaderboard),
                label: 'Rank',
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _bodyFor(EcoSortController controller) {
    switch (_tabIndex) {
      case 1:
        return BadgesTab(controller: controller);
      case 2:
        return RankTab(controller: controller);
      case 0:
      default:
        return ScanTab(controller: controller);
    }
  }
}

class _ModeBanner extends StatelessWidget {
  const _ModeBanner({required this.busy});

  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Theme.of(context).colorScheme.secondaryContainer,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Text(
        busy ? 'Contacting the Flask backend…' : 'Flask backend mode',
        style: Theme.of(context).textTheme.labelSmall,
      ),
    );
  }
}
