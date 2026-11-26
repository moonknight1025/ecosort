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
    required this.initialGroup,
    required this.initialCity,
    required this.onSubmit,
    this.busy = false,
  });

  final String initialUsername;

  /// Community / group: any household, street, society or office. The presets
  /// below are suggestions; the field is free text.
  final String initialGroup;

  /// City / region, also free text with a gentle default.
  final String initialCity;

  final void Function(String username, String group, String city) onSubmit;
  final bool busy;

  @override
  State<ProfileBar> createState() => _ProfileBarState();
}

class _ProfileBarState extends State<ProfileBar> {
  late final TextEditingController _name =
      TextEditingController(text: widget.initialUsername);
  late final TextEditingController _group =
      TextEditingController(text: widget.initialGroup);
  late final TextEditingController _city =
      TextEditingController(text: widget.initialCity);

  @override
  void didUpdateWidget(covariant ProfileBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialUsername != oldWidget.initialUsername) {
      _name.text = widget.initialUsername;
    }
    if (widget.initialGroup != oldWidget.initialGroup) {
      _group.text = widget.initialGroup;
    }
    if (widget.initialCity != oldWidget.initialCity) {
      _city.text = widget.initialCity;
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _group.dispose();
    _city.dispose();
    super.dispose();
  }

  void _submit() => widget.onSubmit(_name.text, _group.text, _city.text);

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
            TextField(
              controller: _group,
              textInputAction: TextInputAction.next,
              maxLength: 48,
              decoration: const InputDecoration(
                labelText: 'Community / group',
                hintText: 'General Community',
                helperText: 'Home, street, society or office - pick one or type your own',
                counterText: '',
                isDense: true,
              ),
              onSubmitted: (String _) => _submit(),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: <Widget>[
                for (final String suggestion in groupSuggestions)
                  ActionChip(
                    label: Text(suggestion, style: const TextStyle(fontSize: 11)),
                    visualDensity: VisualDensity.compact,
                    onPressed: () => setState(() => _group.text = suggestion),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _city,
              textInputAction: TextInputAction.done,
              maxLength: 48,
              decoration: const InputDecoration(
                labelText: 'City / region',
                hintText: 'Local Area',
                counterText: '',
                isDense: true,
              ),
              onSubmitted: (String _) => _submit(),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: <Widget>[
                for (final String suggestion in citySuggestions)
                  ActionChip(
                    label: Text(suggestion, style: const TextStyle(fontSize: 11)),
                    visualDensity: VisualDensity.compact,
                    onPressed: () => setState(() => _city.text = suggestion),
                  ),
              ],
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
