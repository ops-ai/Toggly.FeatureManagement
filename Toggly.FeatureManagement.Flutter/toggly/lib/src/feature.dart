import 'dart:async';

import 'package:flutter/material.dart';

import '../feature_flags_toggly.dart';

/// Feature requirement types allowing "ANY" or "ALL" operations when evaluating
/// feature gates.
enum FeatureRequirement { any, all }

/// Listens for flag and local-gate changes and rebuilds with a fresh snapshot.
class _FeatureGateStreamScope extends StatefulWidget {
  const _FeatureGateStreamScope({required this.builder});

  final Widget Function(BuildContext context, Map<String, bool> flags) builder;

  @override
  State<_FeatureGateStreamScope> createState() =>
      _FeatureGateStreamScopeState();
}

class _FeatureGateStreamScopeState extends State<_FeatureGateStreamScope> {
  StreamSubscription<Map<String, bool>>? _flagsSubscription;
  StreamSubscription<void>? _localGatesSubscription;

  @override
  void initState() {
    super.initState();
    void rebuild(_) {
      if (!mounted) {
        return;
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          setState(() {});
        }
      });
    }

    _flagsSubscription = Toggly.featureFlagsStream.listen(rebuild);
    _localGatesSubscription = Toggly.onLocalGatesChanged.listen(rebuild);
  }

  @override
  void dispose() {
    _flagsSubscription?.cancel();
    _localGatesSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return widget.builder(context, Toggly.featureFlagsSnapshot);
  }
}

/// Resolves a feature gate (remote flags, local gates, requirement, negate,
/// optional variant) and exposes the effective [enabled] boolean to [builder].
///
/// Unlike [Feature], this widget always invokes [builder] — use [enabled] for
/// show/hide or conditional styling instead of returning an empty placeholder.
class FeatureGateBuilder extends StatelessWidget {
  const FeatureGateBuilder({
    Key? key,
    required this.featureKeys,
    this.requirement = FeatureRequirement.all,
    this.negate = false,
    this.context,
    this.kind,

    /// When set, requires [featureKeys.first] to resolve to this variant name
    /// (and [Toggly] must be initialized with `enableVariants: true`).
    /// Treated as disabled until the variant resolves to a match.
    this.variant,
    required this.builder,
  }) : super(key: key);

  final List<String> featureKeys;
  final FeatureRequirement requirement;
  final bool negate;
  final Object? context;
  final String? kind;
  final String? variant;
  final Widget Function(BuildContext context, bool enabled) builder;

  bool _resolveGateEnabled(Map<String, bool> flags) {
    return Toggly.evaluateFeatureGateSync(
      featureKeys,
      flags: flags,
      requirement: requirement,
      negate: negate,
      context: context,
      kind: kind,
    );
  }

  Future<bool> _resolveVariantMatch() async {
    if (variant == null) {
      return true;
    }
    if (featureKeys.isEmpty) {
      return false;
    }
    final vr = await Toggly.getVariant(featureKeys.first);
    return vr.enabled && vr.name == variant;
  }

  @override
  Widget build(BuildContext context) {
    return _FeatureGateStreamScope(
      builder: (context, flags) {
        final gateEnabled = _resolveGateEnabled(flags);

        if (variant == null) {
          return builder(context, gateEnabled);
        }

        if (!gateEnabled) {
          return builder(context, false);
        }

        return FutureBuilder<bool>(
          future: _resolveVariantMatch(),
          builder: (context, variantSnapshot) {
            final enabled = variantSnapshot.data == true;
            return builder(context, enabled);
          },
        );
      },
    );
  }
}

/// Creates a feature Widget that can be enabled, disabled or partially enabled,
/// described by the provided [featureKeys] and following the [requirement] and
/// [negate] parameters.
class Feature extends StatelessWidget {
  const Feature({
    Key? key,
    this.child,
    this.children,
    required this.featureKeys,
    this.requirement = FeatureRequirement.all,
    this.negate = false,
    this.context,
    this.kind,
    this.variant,
  })  : assert(child != null || children != null,
            'Either child or children must be provided'),
        assert(child == null || children == null,
            'Cannot provide both child and children'),
        _builder = null,
        super(key: key);

  const Feature.builder({
    Key? key,
    required this.featureKeys,
    this.requirement = FeatureRequirement.all,
    this.negate = false,
    this.context,
    this.kind,
    this.variant,
    required Widget Function(BuildContext context, bool enabled) builder,
  })  : child = null,
        children = null,
        _builder = builder,
        super(key: key);

  final Widget? child;
  final List<Widget>? children;
  final List<String> featureKeys;
  final FeatureRequirement requirement;
  final bool negate;
  final Object? context;
  final String? kind;
  final String? variant;

  final Widget Function(BuildContext context, bool enabled)? _builder;

  Widget _content() {
    return child ?? Column(children: children!);
  }

  @override
  Widget build(BuildContext buildContext) {
    if (_builder != null) {
      return FeatureGateBuilder(
        featureKeys: featureKeys,
        requirement: requirement,
        negate: negate,
        context: context,
        kind: kind,
        variant: variant,
        builder: _builder!,
      );
    }

    return FeatureGateBuilder(
      featureKeys: featureKeys,
      requirement: requirement,
      negate: negate,
      context: context,
      kind: kind,
      variant: variant,
      builder: (context, enabled) {
        if (enabled) {
          return _content();
        }
        return const SizedBox();
      },
    );
  }
}
