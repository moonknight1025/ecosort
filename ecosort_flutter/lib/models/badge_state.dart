/// A single achievement badge, evaluated from disposal history and points.
class BadgeState {
  const BadgeState({
    required this.id,
    required this.name,
    required this.requirement,
    required this.unlocked,
    required this.emoji,
  });

  final String id;
  final String name;
  final String requirement;
  final bool unlocked;
  final String emoji;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'name': name,
        'requirement': requirement,
        'unlocked': unlocked,
      };

  /// Tolerates a backend that only sends `{id, unlocked}` by falling back to
  /// the local catalogue for the display strings.
  factory BadgeState.fromJson(Map<String, dynamic> json) {
    final String id = (json['id'] as String?) ?? 'unknown';
    return BadgeState(
      id: id,
      name: (json['name'] as String?) ?? id,
      requirement: (json['requirement'] as String?) ?? '',
      unlocked: (json['unlocked'] as bool?) ?? false,
      emoji: (json['emoji'] as String?) ?? '🏅',
    );
  }
}
