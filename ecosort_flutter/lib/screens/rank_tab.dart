import 'package:material_ui/material_ui.dart';

import '../services/ecosort_controller.dart';
import '../widgets/leaderboard_cards.dart';

/// Tab 3 — Campus Rank: campus battle above the individual leaderboard.
class RankTab extends StatelessWidget {
  const RankTab({super.key, required this.controller});

  final EcoSortController controller;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: controller.refreshLeaderboards,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  'Campus Cleanliness Battle',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              IconButton(
                tooltip: 'Refresh',
                onPressed: controller.busy ? null : controller.refreshLeaderboards,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 8),
          CampusStandingsCard(standings: controller.campusStandings),
          const SizedBox(height: 24),
          Text(
            'Top Eco Warriors',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          TopUsersCard(entries: controller.topUsers),
        ],
      ),
    );
  }
}
