<?php
/*
Plugin Name: Toggly Feature Management
Plugin URI: http://toggly.io/
Description: Feature flags around anything. A/B test entire features or sections of your website or store.
Author: opsAI LLC
Version: 1.0
Author URI: http://ops.ai/
*/

// Include the pq library
//require_once( 'path/to/pq.php' );
//require_once( 'path/to/DOM_query.php' );
require_once( 'path/to/phpgt/dom.php' );
use Gt\Dom\HTMLDocument;

// Remove elements that shouldn't be there
function remove_elements_by_selector( $html ) {
    //DOM_query implementation
    // if ( $_SERVER['REQUEST_URI'] === '/index.php' ) {
    //     // Create a DOM_Query object and use it to search for elements
    //     // matching the CSS selector
    //     $dom = new DOM_Query( $html );
    //     $elements = $dom->query( '.my-selector' );
    //     foreach ( $elements as $element ) {
    //         // Remove each element from the HTML output
    //         $element->parentNode->removeChild( $element );
    //     }
    //     $html = $dom->saveHTML();
    // }
    // return $html;


    //phpQuery implementation
    // if ( $_SERVER['REQUEST_URI'] === '/index.php' ) {
    //     // Create a pq object and use it to search for elements
    //     // matching the CSS selector
    //     $pq = pq( $html );
    //     $elements = $pq->find( '.my-selector' );
    //     foreach ( $elements as $element ) {
    //         // Remove each element from the HTML output
    //         pq( $element )->remove();
    //     }
    //     $html = $pq->html();
    // }
    // return $html;

    if ( $_SERVER['REQUEST_URI'] === '/index.php' ) {
        // Create a HTMLDocument object and use it to search for elements
        // matching the CSS selector
        $dom = new HTMLDocument( $html );
        $elements = $dom->querySelectorAll( '.my-selector' );
        foreach ( $elements as $element ) {
            // Remove each element from the HTML output
            $element->parentNode->removeChild( $element );
        }
        $html = $dom->saveHTML();
    }
    return $html;

}
add_filter( 'the_content', 'remove_elements_by_selector', PHP_INT_MAX );

// Load Toggly UI library
function load_toggly_frontend() {
    $url = 'https://cdn.toggly.io/toggly-ui.js';
    // Use the wp_enqueue_script() function to load the library
    wp_enqueue_script( 'toggly-ui', $url, array(), '1.0.0', true );
}

add_action( 'wp_enqueue_scripts', 'load_toggly_frontend' );

?>