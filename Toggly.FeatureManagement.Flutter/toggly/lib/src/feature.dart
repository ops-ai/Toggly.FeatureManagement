import 'dart:async';

import 'package:flutter/material.dart';
import '../feature_flags_toggly.dart';

/// Feature requirement types allowing "ANY" or "ALL" operations when evaluating
/// feature gates.
enum FeatureRequirement { any, all }

/// Creates a feature Widget that can be enabled, disabled or partially enabled,
/// described by the provided [featureKeys] and following the [requirement] and
/// [negate] parameters.
class Feature extends StatefulWidget {
  const Feature({
    Key? key,
    this.child,
    this.children,
    required this.featureKeys,
    this.requirement = FeatureRequirement.all,
    this.negate = false,

    /// When set, requires [featureKeys.first] to resolve to this variant name
    /// (and [Toggly] must be initialized with `enableVariants: true`).
    this.variant,
  })  : assert(child != null || children != null,
            'Either child or children must be provided'),
        assert(child == null || children == null,
            'Cannot provide both child and children'),
        super(key: key);

  final Widget? child;
  final List<Widget>? children;
  final List<String> featureKeys;
  final FeatureRequirement requirement;
  final bool negate;

  /// Optional variant name that must match the first feature key's assignment.
  final String? variant;

  @override
  FeatureState createState() => FeatureState();
}

class FeatureState extends State<Feature> {
  FeatureState();

  bool? previousResult;
  int _localGatesRevision = 0;
  StreamSubscription<void>? _localGatesSubscription;

  @override
  void initState() {
    super.initState();
    _localGatesSubscription = Toggly.onLocalGatesChanged.listen((_) {
      setState(() {
        _localGatesRevision++;
      });
    });
  }

  @override
  void dispose() {
    _localGatesSubscription?.cancel();
    super.dispose();
  }

  Future<bool> _resolveVisible() async {
    final gate = await Toggly.evaluateFeatureGate(
      widget.featureKeys,
      requirement: widget.requirement,
      negate: widget.negate,
    );
    if (!gate) {
      return false;
    }
    if (widget.variant == null) {
      return true;
    }
    if (widget.featureKeys.isEmpty) {
      return false;
    }
    final vr = await Toggly.getVariant(widget.featureKeys.first);
    return vr.enabled && vr.name == widget.variant;
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      key: ValueKey<int>(_localGatesRevision),
      future: _resolveVisible(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.done) {
          previousResult = snapshot.data;
          if (snapshot.data != true) return const SizedBox();

          return widget.child ?? Column(children: widget.children!);
        }

        if (previousResult != true) return const SizedBox();
        return widget.child ?? Column(children: widget.children!);
      },
    );
  }
}
