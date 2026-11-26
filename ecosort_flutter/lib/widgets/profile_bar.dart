import 'package:material_ui/material_ui.dart';

import '../models/user_profile.dart';

/// Profile switcher: free-text name, campus dropdown, and a Set button.
///
/// Stacked vertically on purpose — a side-by-side row overflows at 320-390 px
/// with campus names like "South Hostel", and an overflow is a red screen in
/// debug builds.
class ProfileBar extends StatefulWidget {
  const ProfileBar({
    super.key,
    required this.initialUsername,
    required this.initialCampus,
    required this.onSubmit,
    this.busy = false,
  });

  final String initialUsername;
  final String initialCampus;
  final void Function(String username, String campus) onSubmit;
  final bool busy;

  @override
  State<ProfileBar> createState() => _ProfileBarState();
}

class _ProfileBarState extends State<ProfileBar> {
  late final TextEditingController _name =
      TextEditingController(text: widget.initialUsername);
  late String _campus = widget.initialCampus;

  @override
  void didUpdateWidget(covariant ProfileBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialUsername != oldWidget.initialUsername) {
      _name.text = widget.initialUsername;
    }
    if (widget.initialCampus != oldWidget.initialCampus) {
      _campus = widget.initialCampus;
    }
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _submit() => widget.onSubmit(_name.text, _campus);

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TextField(
              controller: _name,
              textInputAction: TextInputAction.done,
              maxLength: 32,
              decoration: const InputDecoration(
                labelText: 'Your name',
                counterText: '',
                isDense: true,
              ),
              onSubmitted: (String _) => _submit(),
            ),
            const SizedBox(height: 10),
            InputDecorator(
              decoration: const InputDecoration(
                labelText: 'Campus',
                isDense: true,
                contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: campuses.contains(_campus) ? _campus : defaultCampus,
                  isExpanded: true,
                  isDense: true,
                  items: <DropdownMenuItem<String>>[
                    for (final String campus in campuses)
                      DropdownMenuItem<String>(
                        value: campus,
                        child: Text(campus, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: (String? value) {
                    if (value != null) {
                      setState(() => _campus = value);
                    }
                  },
                ),
              ),
            ),
            const SizedBox(height: 10),
            FilledButton.tonalIcon(
              onPressed: widget.busy ? null : _submit,
              icon: const Icon(Icons.person_outline),
              label: const Text('Set profile'),
            ),
          ],
        ),
      ),
    );
  }
}
