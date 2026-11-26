import 'badge_state.dart';
import 'challenge_day.dart';
import 'user_profile.dart';
import 'waste_category.dart';

/// Everything the UI needs to render one user's world.
///
/// The same shape is produced by the local repository (from persisted state)
/// and by the API repository (from `/api/user`), which is what lets the widgets
/// stay agnostic about which data mode is active.
class AppSnapshot {
  const AppSnapshot({
    required this.user,
    required this.badges,
    required this.challenges,
    required this.binCounts,
    required this.totalDisposals,
    required this.plasticDisposals,
    required this.hazardDisposals,
  });

  final UserProfile user;
  final List<BadgeState> badges;
  final List<ChallengeDay> challenges;

  /// Disposals per bin for this user; every category is always present.
  final Map<WasteCategory, int> binCounts;

  final int totalDisposals;
  final int plasticDisposals;
  final int hazardDisposals;

  int binCount(WasteCategory category) => binCounts[category] ?? 0;

  int get claimedDays => challenges.where((day) => day.completed).length;

  factory AppSnapshot.empty(String username, String campus) {
    return AppSnapshot(
      user: UserProfile(username: username, campus: campus, ecoPoints: 0),
      badges: const <BadgeState>[],
      challenges: const <ChallengeDay>[],
      binCounts: <WasteCategory, int>{
        for (final category in WasteCategory.values) category: 0,
      },
      totalDisposals: 0,
      plasticDisposals: 0,
      hazardDisposals: 0,
    );
  }
}
