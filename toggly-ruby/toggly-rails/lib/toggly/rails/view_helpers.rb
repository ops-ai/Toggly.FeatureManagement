# frozen_string_literal: true

module Toggly
  module Rails
    # View helpers for feature flags in Rails views.
    #
    # These helpers are automatically included in ActionView
    # when using the Railtie.
    module ViewHelpers
      # Check if a feature is enabled
      #
      # @param feature_key [String, Symbol] Feature key
      # @param context [Toggly::Context, nil] Optional override context
      # @return [Boolean]
      def feature_enabled?(feature_key, context: nil)
        if controller.respond_to?(:feature_enabled?, true)
          controller.send(:feature_enabled?, feature_key, context: context)
        else
          ctx = context || view_toggly_context
          Toggly.enabled?(feature_key, context: ctx)
        end
      end

      # Check if a feature is disabled
      #
      # @param feature_key [String, Symbol] Feature key
      # @param context [Toggly::Context, nil] Optional override context
      # @return [Boolean]
      def feature_disabled?(feature_key, context: nil)
        !feature_enabled?(feature_key, context: context)
      end

      # Assigned catalog-local variant. Uses controller +toggly_context+ when
      # +context+ is omitted (same ambient path as {#feature_enabled?}).
      #
      # @param feature_key [String, Symbol] Feature key
      # @param context [Toggly::Context, nil] Optional override context
      # @return [Toggly::VariantResult, nil]
      def feature_variant(feature_key, context: nil)
        if controller.respond_to?(:feature_variant, true)
          controller.send(:feature_variant, feature_key, context: context)
        else
          ctx = context || view_toggly_context
          Toggly.get_variant(feature_key, context: ctx)
        end
      end

      # Configuration value for the assigned variant. See {#feature_variant}.
      #
      # @param feature_key [String, Symbol] Feature key
      # @param context [Toggly::Context, nil] Optional override context
      # @return [Object, nil]
      def feature_variant_value(feature_key, context: nil)
        if controller.respond_to?(:feature_variant_value, true)
          controller.send(:feature_variant_value, feature_key, context: context)
        else
          feature_variant(feature_key, context: context)&.configuration_value
        end
      end

      # Render content when the feature evaluation matches the requested branch
      #
      # @param feature_key [String, Symbol] Feature key
      # @param context [Toggly::Context, nil] Optional override context
      # @param negate [Boolean] Render when the feature is disabled
      # @yield Content to render for the selected branch
      # @return [String, nil]
      def feature(feature_key, context: nil, negate: false, &)
        enabled = feature_enabled?(feature_key, context: context)
        return unless negate ? !enabled : enabled

        capture(&) if block_given?
      end

      # Render content only if feature is enabled
      #
      # @deprecated Use {#feature}.
      # @param feature_key [String, Symbol] Feature key
      # @param context [Toggly::Context, nil] Optional override context
      # @yield Content to render when enabled
      # @return [String, nil]
      def when_feature_enabled(feature_key, context: nil, &)
        feature(feature_key, context: context, negate: false, &)
      end

      # Render content only if feature is disabled
      #
      # @deprecated Use {#feature} with +negate: true+.
      # @param feature_key [String, Symbol] Feature key
      # @param context [Toggly::Context, nil] Optional override context
      # @yield Content to render when disabled
      # @return [String, nil]
      def when_feature_disabled(feature_key, context: nil, &)
        feature(feature_key, context: context, negate: true, &)
      end

      # Render enabled or disabled content based on feature state
      #
      # @param feature_key [String, Symbol] Feature key
      # @param enabled [String, nil] Content when enabled
      # @param disabled [String, nil] Content when disabled
      # @param context [Toggly::Context, nil] Optional override context
      # @return [String]
      def feature_switch(feature_key, enabled: nil, disabled: nil, context: nil)
        if feature_enabled?(feature_key, context: context)
          enabled
        else
          disabled
        end
      end

      private

      def view_toggly_context
        # Try to get context from controller
        if controller.respond_to?(:toggly_context, true)
          controller.send(:toggly_context)
        else
          Toggly::Context.anonymous
        end
      end
    end
  end
end
