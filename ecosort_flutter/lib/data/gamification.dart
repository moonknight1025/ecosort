import '../models/badge_state.dart';
import '../models/waste_category.dart';

/// Definition of one achievement badge, plus its unlock predicate.
class BadgeDefinition {
  const BadgeDefinition({
    required this.id,
    required this.name,
    required this.requirement,
    required this.emoji,
  });

  final String id;
  final String name;
  final String requirement;
  final String emoji;

  bool isUnlocked({
    required int totalDisposals,
    required int plasticDisposals,
    required int hazardDisposals,
    required int ecoPoints,
  }) {
    return switch (id) {
      'first_step' => totalDisposals >= 1,
      'plastic_warrior' => plasticDisposals >= 3,
      'hazard_hero' => hazardDisposals >= 1,
      'green_champion' => ecoPoints >= 100,
      _ => false,
    };
  }
}

/// The four badges, in display order (2-column grid).
const List<BadgeDefinition> badgeCatalog = <BadgeDefinition>[
  BadgeDefinition(
    id: 'first_step',
    name: 'First Step',
    requirement: 'Log your first disposal',
    emoji: '🌱',
  ),
  BadgeDefinition(
    id: 'plastic_warrior',
    name: 'Plastic Warrior',
    requirement: '3 recyclable or dry-waste disposals',
    emoji: '♻️',
  ),
  BadgeDefinition(
    id: 'hazard_hero',
    name: 'Hazard Hero',
    requirement: '1 e-waste or hazardous disposal',
    emoji: '🦸',
  ),
  BadgeDefinition(
    id: 'green_champion',
    name: 'Green Champion',
    requirement: 'Bank 100 Eco Points',
    emoji: '🏆',
  ),
];

/// Categories that count towards `Plastic Warrior`.
const Set<WasteCategory> plasticCategories = <WasteCategory>{
  WasteCategory.recyclable,
  WasteCategory.dry,
};

/// Categories that count towards `Hazard Hero`.
const Set<WasteCategory> hazardCategories = <WasteCategory>{
  WasteCategory.ewaste,
  WasteCategory.hazardous,
};

/// Evaluate every badge from history. Never stored as a mutable flag, so it
/// cannot drift from the log.
List<BadgeState> evaluateBadges({
  required int totalDisposals,
  required int plasticDisposals,
  required int hazardDisposals,
  required int ecoPoints,
}) {
  return <BadgeState>[
    for (final BadgeDefinition definition in badgeCatalog)
      BadgeState(
        id: definition.id,
        name: definition.name,
        requirement: definition.requirement,
        emoji: definition.emoji,
        unlocked: definition.isUnlocked(
          totalDisposals: totalDisposals,
          plasticDisposals: plasticDisposals,
          hazardDisposals: hazardDisposals,
          ecoPoints: ecoPoints,
        ),
      ),
  ];
}
