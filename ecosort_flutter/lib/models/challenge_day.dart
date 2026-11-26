/// One day of the 7-Day Zero-Waste Challenge.
class ChallengeDay {
  const ChallengeDay({
    required this.dayNumber,
    required this.task,
    required this.completed,
  });

  final int dayNumber;
  final String task;
  final bool completed;

  ChallengeDay copyWith({bool? completed}) {
    return ChallengeDay(
      dayNumber: dayNumber,
      task: task,
      completed: completed ?? this.completed,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'day_number': dayNumber,
        'task': task,
        'completed': completed,
      };

  factory ChallengeDay.fromJson(Map<String, dynamic> json) {
    return ChallengeDay(
      dayNumber: (json['day_number'] as num?)?.toInt() ?? 0,
      task: (json['task'] as String?) ?? '',
      completed: (json['completed'] as bool?) ?? false,
    );
  }
}
