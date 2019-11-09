import React, { Component } from 'react'
import Pokecard from './Pokecard'
import './Pokedex.css'

export default class Pokedex extends Component {
  render() {
    let title;
    if(this.props.isWinner){
      title = <h1 className="Pokedex-winner">WINNER HANDS</h1>
    }else{
      title = <h1 className="Pokedex-loser">LOSER HAND</h1>
    }
    return (
      <div className="Pokedex">
      {title}
        <h1>Pokedex</h1>
        <h4>TOTAL EXP: {this.props.exp}</h4>
      <div className="Pokedex-cards">
      {this.props.pokemon.map((p) =>(
          <Pokecard id={p.id} name={p.name} type={p.type} exp={p.base_experience}/>
        ))}
      </div>
      
      </div>
    )
  }
}
